export type DatePreset = 'all' | 'today' | 'week' | 'tendays' | 'fifteendays' | 'month' | 'lastmonth' | 'custom';
export type LedgerKind = 'Opening' | 'Milk' | 'Material' | 'Payment' | 'Refund' | 'Charge';
export type LedgerTypeFilter = 'All' | 'Milk' | 'Material' | 'Payment';

export interface StatementCompany {
  name: string;
  address?: string;
  phone?: string;
}

export interface StatementSupplier {
  id: string;
  name: string;
  phone?: string;
  whatsapp?: string;
  village?: string;
  city?: string;
  address?: string;
  pendingBalance: number;
}

interface RawPurchase {
  id: string;
  supplier_id?: string;
  date?: string;
  quantity?: number;
  milk_type?: string;
  shift?: string;
  rate?: number;
  fat?: number;
  snf?: number;
  total_amount?: number;
  paid_amount?: number;
  status?: string;
  details?: { paid_amount?: number; due_amount?: number };
}

interface RawMaterial {
  id: string;
  supplier_id?: string;
  date?: string;
  item_name?: string;
  quantity?: number;
  unit?: string;
  total_amount?: number;
  paid_amount?: number;
  status?: string;
  details?: { paid_amount?: number };
}

interface RawTx {
  id: string;
  supplier_id?: string;
  date?: string;
  type?: string;
  amount?: number;
  mode?: string;
  note?: string;
  account_id?: string;
  details?: {
    mode?: string;
    note?: string;
    purchase_id?: string;
    cash_refund?: number;
    account_id?: string;
  };
}

export interface LedgerRow {
  id: string;
  date: string;
  description: string;
  debit: number;
  credit: number;
  kind: LedgerKind;
  subtype?: string;
  mode?: string;
  note?: string;
  canDelete: boolean;
  litres?: number;
  accountName?: string;
  runningBalance: number;
}

export interface CashLine {
  id: string;
  date: string;
  supplierId: string;
  supplierName: string;
  phone?: string;
  direction: 'out' | 'in';
  amount: number;
  mode: string;
  note?: string;
  subtype: string;
  accountName?: string;
  canDelete: boolean;
}

export interface CashDay {
  date: string;
  paid: number;
  refunded: number;
  net: number;
  rows: CashLine[];
}

export interface SupplierStatement {
  entries: LedgerRow[];
  printRows: LedgerRow[];
  openingBalance: number;
  closingBalance: number;
  totalMilkLitres: number;
  totalCredit: number;
  totalDebit: number;
  netPaid: number;
  refunds: number;
  cashOut: number;
  cashIn: number;
  cashPaid: number;
  otherPaid: number;
  paymentCount: number;
  paymentDays: CashDay[];
  rangeLabel: string;
  hasRange: boolean;
  milkStats?: {
    totalLitres: number;
    totalAmount: number;
    avgRate: number;
    morningLitres: number;
    eveningLitres: number;
    avgFat: number;
    avgSnf: number;
  };
}

const KIND_ORDER: Record<LedgerKind, number> = {
  Opening: 0,
  Milk: 1,
  Material: 2,
  Charge: 3,
  Payment: 4,
  Refund: 5
};

export function money(value: number) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

export function localIsoDate(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function rangeForPreset(preset: DatePreset, from = '', to = '') {
  const today = localIsoDate();
  if (preset === 'today') return { from: today, to: today };
  if (preset === 'week') {
    const now = new Date();
    const weekday = now.getDay();
    const mondayOffset = weekday === 0 ? 6 : weekday - 1;
    const start = new Date(now);
    start.setDate(now.getDate() - mondayOffset);
    return { from: localIsoDate(start), to: today };
  }
  if (preset === 'tendays') {
    const now = new Date();
    const day = now.getDate();
    const year = now.getFullYear();
    const month = now.getMonth();
    if (day <= 10) {
      return { from: localIsoDate(new Date(year, month, 1)), to: localIsoDate(new Date(year, month, 10)) };
    } else if (day <= 20) {
      return { from: localIsoDate(new Date(year, month, 11)), to: localIsoDate(new Date(year, month, 20)) };
    } else {
      const lastDay = new Date(year, month + 1, 0).getDate();
      return { from: localIsoDate(new Date(year, month, 21)), to: localIsoDate(new Date(year, month, lastDay)) };
    }
  }
  if (preset === 'fifteendays') {
    const now = new Date();
    const day = now.getDate();
    const year = now.getFullYear();
    const month = now.getMonth();
    if (day <= 15) {
      return { from: localIsoDate(new Date(year, month, 1)), to: localIsoDate(new Date(year, month, 15)) };
    } else {
      const lastDay = new Date(year, month + 1, 0).getDate();
      return { from: localIsoDate(new Date(year, month, 16)), to: localIsoDate(new Date(year, month, lastDay)) };
    }
  }
  if (preset === 'month') {
    const now = new Date();
    return { from: localIsoDate(new Date(now.getFullYear(), now.getMonth(), 1)), to: today };
  }
  if (preset === 'lastmonth') {
    const now = new Date();
    const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
    return { from: localIsoDate(prevMonthStart), to: localIsoDate(prevMonthEnd) };
  }
  if (preset === 'custom') {
    let start = (from || '').slice(0, 10);
    let end = (to || '').slice(0, 10);
    if (start && end && start > end) [start, end] = [end, start];
    return { from: start, to: end };
  }
  return { from: '', to: '' };
}

export function formatLedgerDate(iso: string, withWeekday = false) {
  const day = (iso || '').slice(0, 10);
  if (!day) return 'Opening';
  const [year, month, date] = day.split('-').map(Number);
  if (!year || !month || !date) return day;
  return new Date(year, month - 1, date).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    weekday: withWeekday ? 'short' : undefined
  });
}

export function formatMoney(amount: number) {
  return `Rs ${Math.abs(money(amount)).toLocaleString('en-PK')}`;
}

export function balancePhrase(amount: number) {
  const value = money(amount);
  if (Math.abs(value) < 0.5) return 'Rs 0 Settled';
  return value > 0 ? `${formatMoney(value)} Payable` : `${formatMoney(value)} Advance`;
}

export function rangeLabel(from: string, to: string) {
  if (!from && !to) return 'All dates';
  if (from && to && from === to) return formatLedgerDate(from);
  if (from && to) return `${formatLedgerDate(from)} – ${formatLedgerDate(to)}`;
  if (from) return `From ${formatLedgerDate(from)}`;
  return `Until ${formatLedgerDate(to)}`;
}

function dayKey(value?: string) {
  return (value || '').slice(0, 10);
}

function inRange(date: string, from: string, to: string) {
  if (!from && !to) return true;
  const day = dayKey(date);
  if (!day) return false;
  if (from && day < from) return false;
  if (to && day > to) return false;
  return true;
}

function isVoid(status?: string) {
  const value = (status || '').toLowerCase();
  return value === 'returned' || value === 'cancelled' || value === 'canceled';
}

function isPaymentType(type?: string) {
  return type === 'Payment' || type === 'Advance' || type === 'Debit';
}

function txNote(tx: RawTx) {
  return tx.note || tx.details?.note || '';
}

function txMode(tx: RawTx) {
  return tx.mode || tx.details?.mode || 'Cash';
}

function txAccount(tx: RawTx) {
  return tx.account_id || tx.details?.account_id || '';
}

function paidOf(row: { paid_amount?: number; details?: { paid_amount?: number } }) {
  const paid = row.paid_amount ?? row.details?.paid_amount ?? 0;
  return money(paid);
}

function linkedPurchaseId(tx: RawTx) {
  if (tx.details?.purchase_id) return tx.details.purchase_id;
  const id = String(tx.id || '');
  if (id.startsWith('stx_pur_')) return id.slice('stx_pur_'.length);
  return '';
}

function isSpotPayment(tx: RawTx) {
  const id = String(tx.id || '');
  return id.startsWith('stx_pur_') || id.startsWith('stx_mp_') || /spot payment/i.test(txNote(tx));
}

function isCashMode(mode?: string) {
  return !mode || mode.toLowerCase().includes('cash');
}

function escapeHtml(value: unknown) {
  return String(value ?? '').replace(/[&<>"']/g, char => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] || char
  ));
}

function matchPayments(purchase: { id: string; date?: string; paid_amount?: number; details?: { paid_amount?: number } }, txs: RawTx[], used: Set<string>) {
  const matched: RawTx[] = [];
  const exact = txs.filter(tx => isPaymentType(tx.type) && !used.has(tx.id) && (
    tx.details?.purchase_id === purchase.id || tx.id === `stx_pur_${purchase.id}` || tx.id === `stx_mp_${purchase.id}`
  ));
  exact.forEach(tx => {
    used.add(tx.id);
    matched.push(tx);
  });
  let covered = matched.reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
  const target = paidOf(purchase);
  if (target - covered <= 0.5) return matched;

  const spot = txs.find(tx => (
    isPaymentType(tx.type) &&
    !used.has(tx.id) &&
    isSpotPayment(tx) &&
    dayKey(tx.date) === dayKey(purchase.date) &&
    Math.abs(Number(tx.amount || 0) - (target - covered)) < 1
  ));
  if (spot) {
    used.add(spot.id);
    matched.push(spot);
  }
  return matched;
}

function accountLabel(accountId: string | undefined, accountNames: Record<string, string>) {
  if (!accountId) return '';
  return accountNames[accountId] || '';
}

export function emptySupplierStatement(from = '', to = ''): SupplierStatement {
  return {
    entries: [],
    printRows: [],
    openingBalance: 0,
    closingBalance: 0,
    totalMilkLitres: 0,
    totalCredit: 0,
    totalDebit: 0,
    netPaid: 0,
    refunds: 0,
    cashOut: 0,
    cashIn: 0,
    cashPaid: 0,
    otherPaid: 0,
    paymentCount: 0,
    paymentDays: [],
    rangeLabel: rangeLabel(from, to),
    hasRange: Boolean(from || to)
  };
}

export function buildSupplierStatement(input: {
  supplier: StatementSupplier;
  purchases?: RawPurchase[];
  materialPurchases?: RawMaterial[];
  transactions?: RawTx[];
  from?: string;
  to?: string;
  kind?: LedgerTypeFilter;
  query?: string;
  accountNames?: Record<string, string>;
}): SupplierStatement {
  const from = input.from || '';
  const to = input.to || '';
  const kind = input.kind || 'All';
  const query = (input.query || '').trim().toLowerCase();
  const accountNames = input.accountNames || {};
  const supplierId = input.supplier.id;
  const purchases = (input.purchases || []).filter(row => row.supplier_id === supplierId);
  const materials = (input.materialPurchases || []).filter(row => row.supplier_id === supplierId);
  const transactions = (input.transactions || []).filter(row => row.supplier_id === supplierId);
  const voidedIds = new Set<string>();
  const khataSkip = new Set<string>();
  const allocated = new Set<string>();

  [...purchases, ...materials].forEach(row => {
    if (isVoid(row.status)) voidedIds.add(row.id);
  });
  [...purchases, ...materials].filter(row => voidedIds.has(row.id)).forEach(row => {
    matchPayments(row, transactions, allocated).forEach(tx => khataSkip.add(tx.id));
  });

  const khata: Omit<LedgerRow, 'runningBalance'>[] = [];
  const cash: CashLine[] = [];

  const pushCash = (line: CashLine) => {
    if (line.amount > 0.5 && line.date) cash.push(line);
  };

  purchases.filter(row => !voidedIds.has(row.id)).forEach(row => {
    const credit = money(row.total_amount || 0);
    if (credit <= 0.5) return;
    const quality = [
      Number(row.fat) > 0 ? `Fat ${row.fat}` : '',
      Number(row.snf) > 0 ? `SNF ${row.snf}` : ''
    ].filter(Boolean).join(' · ');
    khata.push({
      id: row.id,
      date: dayKey(row.date),
      description: `Milk ${Number(row.quantity || 0)}L ${row.milk_type || ''} · ${row.shift || 'Shift'}${Number(row.rate) > 0 ? ` @ Rs ${row.rate}/L` : ''}${quality ? ` · ${quality}` : ''}`.replace(/\s+/g, ' ').trim(),
      credit,
      debit: 0,
      kind: 'Milk',
      litres: Number(row.quantity || 0),
      canDelete: false
    });
    const matched = matchPayments(row, transactions, allocated);
    const covered = matched.reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
    const gap = money(paidOf(row) - covered);
    if (gap > 0.5) {
      const syntheticId = `spot_milk_${row.id}`;
      khata.push({
        id: syntheticId,
        date: dayKey(row.date),
        description: 'Spot payment for milk',
        credit: 0,
        debit: gap,
        kind: 'Payment',
        subtype: 'Payment',
        mode: 'Cash',
        canDelete: false
      });
      pushCash({
        id: syntheticId,
        date: dayKey(row.date),
        supplierId,
        supplierName: input.supplier.name,
        phone: input.supplier.phone,
        direction: 'out',
        amount: gap,
        mode: 'Cash',
        note: 'Spot payment for milk',
        subtype: 'Payment',
        canDelete: false
      });
    }
  });

  materials.filter(row => !voidedIds.has(row.id)).forEach(row => {
    const credit = money(row.total_amount || 0);
    if (credit <= 0.5) return;
    khata.push({
      id: row.id,
      date: dayKey(row.date),
      description: `Material ${row.item_name || 'Item'} (${Number(row.quantity || 0)} ${row.unit || ''})`.replace(/\s+/g, ' ').trim(),
      credit,
      debit: 0,
      kind: 'Material',
      canDelete: false
    });
    const matched = matchPayments(row, transactions, allocated);
    const covered = matched.reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
    const gap = money(paidOf(row) - covered);
    if (gap > 0.5) {
      const syntheticId = `spot_mat_${row.id}`;
      khata.push({
        id: syntheticId,
        date: dayKey(row.date),
        description: 'Spot payment for material',
        credit: 0,
        debit: gap,
        kind: 'Payment',
        subtype: 'Payment',
        mode: 'Cash',
        canDelete: false
      });
      pushCash({
        id: syntheticId,
        date: dayKey(row.date),
        supplierId,
        supplierName: input.supplier.name,
        phone: input.supplier.phone,
        direction: 'out',
        amount: gap,
        mode: 'Cash',
        note: 'Spot payment for material',
        subtype: 'Payment',
        canDelete: false
      });
    }
  });

  transactions.forEach(tx => {
    const date = dayKey(tx.date);
    const amount = money(tx.amount || 0);
    const mode = txMode(tx);
    const note = txNote(tx);
    const accountName = accountLabel(txAccount(tx), accountNames);
    const link = linkedPurchaseId(tx);
    const voided = Boolean(link && voidedIds.has(link)) || khataSkip.has(tx.id);

    if (isPaymentType(tx.type)) {
      if (amount > 0.5) {
        pushCash({
          id: tx.id,
          date,
          supplierId,
          supplierName: input.supplier.name,
          phone: input.supplier.phone,
          direction: 'out',
          amount,
          mode,
          note,
          subtype: tx.type === 'Advance' ? 'Advance' : 'Payment',
          accountName,
          canDelete: !isSpotPayment(tx)
        });
      }
      if (!voided && amount > 0.5) {
        const label = tx.type === 'Advance' ? 'Advance paid' : 'Payment paid';
        khata.push({
          id: tx.id,
          date,
          description: `${label} (${mode})`,
          credit: 0,
          debit: amount,
          kind: 'Payment',
          subtype: tx.type,
          mode,
          note,
          accountName,
          canDelete: !isSpotPayment(tx)
        });
      }
      return;
    }

    if (tx.type === 'Return') {
      const refund = money(tx.details?.cash_refund || 0);
      if (refund > 0.5) {
        pushCash({
          id: `refund_${tx.id}`,
          date,
          supplierId,
          supplierName: input.supplier.name,
          phone: input.supplier.phone,
          direction: 'in',
          amount: refund,
          mode,
          note: note || 'Cash refund on return',
          subtype: 'Refund',
          accountName,
          canDelete: false
        });
      }
      if (!voided && refund > 0.5 && link) {
        khata.push({
          id: `refund_${tx.id}`,
          date,
          description: 'Cash refund on return',
          credit: refund,
          debit: 0,
          kind: 'Refund',
          subtype: 'Refund',
          mode,
          note,
          accountName,
          canDelete: false
        });
      } else if (!voided && !link) {
        const drop = money(amount - refund);
        if (drop > 0.5) {
          khata.push({
            id: tx.id,
            date,
            description: 'Purchase return',
            credit: 0,
            debit: drop,
            kind: 'Payment',
            subtype: 'Return',
            mode,
            note,
            canDelete: false
          });
        }
      }
      return;
    }

    if ((tx.type === 'Charge' || tx.type === 'Supply') && amount > 0.5) {
      khata.push({
        id: tx.id,
        date,
        description: tx.type === 'Supply' ? 'Supply charge' : 'Supplier charge',
        credit: amount,
        debit: 0,
        kind: 'Charge',
        subtype: tx.type,
        note,
        canDelete: true
      });
    }
  });

  const movement = khata.reduce((sum, row) => sum + row.credit - row.debit, 0);
  const openingAdjust = money((Number(input.supplier.pendingBalance) || 0) - movement);
  if (Math.abs(openingAdjust) >= 1) {
    khata.unshift({
      id: `opening_${supplierId}`,
      date: '',
      description: 'Opening balance',
      credit: openingAdjust > 0 ? openingAdjust : 0,
      debit: openingAdjust < 0 ? Math.abs(openingAdjust) : 0,
      kind: 'Opening',
      canDelete: false
    });
  }

  khata.sort((a, b) => {
    const left = a.date || '0000-00-00';
    const right = b.date || '0000-00-00';
    if (left !== right) return left < right ? -1 : 1;
    const kindDiff = KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
    return kindDiff || a.id.localeCompare(b.id);
  });

  let running = 0;
  const withBalance: LedgerRow[] = khata.map(row => {
    running = money(running + row.credit - row.debit);
    return { ...row, runningBalance: running };
  });

  const periodRows = withBalance.filter(row => row.kind === 'Opening' ? !from && !to : inRange(row.date, from, to));
  const beforeRows = from
    ? withBalance.filter(row => row.date && dayKey(row.date) < from)
    : withBalance.filter(row => row.kind === 'Opening');
  const openingBalance = beforeRows.length ? beforeRows[beforeRows.length - 1].runningBalance : (periodRows.find(row => row.kind === 'Opening')?.runningBalance || 0);
  const closingBalance = periodRows.length ? periodRows[periodRows.length - 1].runningBalance : openingBalance;
  const movementRows = periodRows.filter(row => row.kind !== 'Opening');
  const totalCredit = money(movementRows.filter(row => row.kind !== 'Refund').reduce((sum, row) => sum + row.credit, 0));
  const refunds = money(movementRows.filter(row => row.kind === 'Refund').reduce((sum, row) => sum + row.credit, 0));
  const grossPaid = money(movementRows.reduce((sum, row) => sum + row.debit, 0));
  const netPaid = money(grossPaid - refunds);

  const matchesQuery = (text: string) => !query || text.toLowerCase().includes(query);
  const matchesKind = (row: LedgerRow) => {
    if (kind === 'All') return true;
    if (kind === 'Payment') return row.kind === 'Payment' || row.kind === 'Refund';
    return row.kind === kind;
  };

  const filteredMovementRows = movementRows.filter(row =>
    matchesKind(row) && matchesQuery(`${row.description} ${row.note || ''} ${row.date} ${row.mode || ''} ${row.accountName || ''}`)
  );

  const entries = [...filteredMovementRows].reverse();
  const printRows = filteredMovementRows;

  // Compute detailed milk analytics for this supplier in this period:
  const periodPurchases = purchases.filter(p => !voidedIds.has(p.id) && inRange(p.date || '', from, to));
  const morningMilk = periodPurchases.filter(p => (p.shift || '').toLowerCase().includes('morn'));
  const eveningMilk = periodPurchases.filter(p => (p.shift || '').toLowerCase().includes('even'));
  const morningLitres = money(morningMilk.reduce((s, p) => s + Number(p.quantity || 0), 0));
  const eveningLitres = money(eveningMilk.reduce((s, p) => s + Number(p.quantity || 0), 0));
  const milkAmount = money(periodPurchases.reduce((s, p) => s + Number(p.total_amount || 0), 0));
  const milkLitres = money(periodPurchases.reduce((s, p) => s + Number(p.quantity || 0), 0));
  const avgMilkRate = milkLitres > 0 ? money(milkAmount / milkLitres) : 0;

  let fatSum = 0;
  let fatQty = 0;
  let snfSum = 0;
  let snfQty = 0;
  periodPurchases.forEach(p => {
    const q = Number(p.quantity || 0);
    const f = Number(p.fat || 0);
    const s = Number(p.snf || 0);
    if (q > 0 && f > 0) { fatSum += (q * f); fatQty += q; }
    if (q > 0 && s > 0) { snfSum += (q * s); snfQty += q; }
  });
  const avgFat = fatQty > 0 ? Math.round((fatSum / fatQty) * 10) / 10 : 0;
  const avgSnf = snfQty > 0 ? Math.round((snfSum / snfQty) * 10) / 10 : 0;

  const milkStats = {
    totalLitres: milkLitres,
    totalAmount: milkAmount,
    avgRate: avgMilkRate,
    morningLitres,
    eveningLitres,
    avgFat,
    avgSnf
  };

  const periodCash = cash.filter(line => inRange(line.date, from, to));
  const visibleCash = periodCash.filter(line => matchesQuery(`${line.supplierName} ${line.phone || ''} ${line.note || ''} ${line.mode} ${line.subtype} ${line.accountName || ''} ${line.date}`));
  const paymentDays = groupCash(visibleCash);
  const cashOut = money(periodCash.filter(line => line.direction === 'out').reduce((sum, line) => sum + line.amount, 0));
  const cashIn = money(periodCash.filter(line => line.direction === 'in').reduce((sum, line) => sum + line.amount, 0));
  const cashPaid = money(periodCash.filter(line => line.direction === 'out' && isCashMode(line.mode)).reduce((sum, line) => sum + line.amount, 0)
    - periodCash.filter(line => line.direction === 'in' && isCashMode(line.mode)).reduce((sum, line) => sum + line.amount, 0));
  const otherPaid = money((cashOut - cashIn) - cashPaid);

  return {
    entries,
    printRows,
    openingBalance: money(openingBalance),
    closingBalance: money(closingBalance),
    totalMilkLitres: money(movementRows.reduce((sum, row) => sum + Number(row.litres || 0), 0)),
    totalCredit,
    totalDebit: netPaid,
    netPaid,
    refunds,
    cashOut,
    cashIn,
    cashPaid,
    otherPaid,
    paymentCount: periodCash.filter(line => line.direction === 'out').length,
    paymentDays,
    rangeLabel: rangeLabel(from, to),
    hasRange: Boolean(from || to),
    milkStats
  };
}

function groupCash(lines: CashLine[]): CashDay[] {
  const byDate = new Map<string, CashLine[]>();
  lines.forEach(line => {
    const list = byDate.get(line.date) || [];
    list.push(line);
    byDate.set(line.date, list);
  });
  return Array.from(byDate.entries())
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([date, rows]) => {
      const ordered = [...rows].sort((a, b) => a.supplierName.localeCompare(b.supplierName) || a.id.localeCompare(b.id));
      const paid = money(ordered.filter(row => row.direction === 'out').reduce((sum, row) => sum + row.amount, 0));
      const refunded = money(ordered.filter(row => row.direction === 'in').reduce((sum, row) => sum + row.amount, 0));
      return { date, paid, refunded, net: money(paid - refunded), rows: ordered };
    });
}

export function buildPaymentRegister(input: {
  suppliers: StatementSupplier[];
  purchases?: RawPurchase[];
  materialPurchases?: RawMaterial[];
  transactions?: RawTx[];
  from?: string;
  to?: string;
  query?: string;
  accountNames?: Record<string, string>;
}) {
  const lines: CashLine[] = [];
  input.suppliers.forEach(supplier => {
    const statement = buildSupplierStatement({
      supplier,
      purchases: input.purchases,
      materialPurchases: input.materialPurchases,
      transactions: input.transactions,
      from: input.from,
      to: input.to,
      accountNames: input.accountNames
    });
    statement.paymentDays.forEach(day => lines.push(...day.rows));
  });
  const query = (input.query || '').trim().toLowerCase();
  const filtered = query
    ? lines.filter(line => `${line.supplierName} ${line.phone || ''} ${line.note || ''} ${line.mode} ${line.accountName || ''}`.toLowerCase().includes(query))
    : lines;
  const days = groupCash(filtered);
  const cashOut = money(filtered.filter(line => line.direction === 'out').reduce((sum, line) => sum + line.amount, 0));
  const cashIn = money(filtered.filter(line => line.direction === 'in').reduce((sum, line) => sum + line.amount, 0));
  const cashPaid = money(filtered.filter(line => line.direction === 'out' && isCashMode(line.mode)).reduce((sum, line) => sum + line.amount, 0)
    - filtered.filter(line => line.direction === 'in' && isCashMode(line.mode)).reduce((sum, line) => sum + line.amount, 0));
  return {
    days,
    cashOut,
    cashIn,
    net: money(cashOut - cashIn),
    cashPaid,
    otherPaid: money((cashOut - cashIn) - cashPaid),
    count: filtered.filter(line => line.direction === 'out').length,
    rangeLabel: rangeLabel(input.from || '', input.to || '')
  };
}

export interface DailySummaryRow {
  date: string;
  milkLitres: number;
  milkCredit: number;
  milkDetails: string;
  materialCredit: number;
  materialDetails: string;
  paymentDebit: number;
  paymentDetails: string;
  otherCredit: number;
  otherDebit: number;
  dayCredit: number;
  dayDebit: number;
  runningBalance: number;
}

export function buildDailySummary(rows: LedgerRow[]): DailySummaryRow[] {
  const byDate = new Map<string, LedgerRow[]>();
  rows.forEach(r => {
    if (!r.date) return;
    const list = byDate.get(r.date) || [];
    list.push(r);
    byDate.set(r.date, list);
  });

  const sortedDates = Array.from(byDate.keys()).sort();
  return sortedDates.map(date => {
    const dayRows = byDate.get(date)!;
    const milkRows = dayRows.filter(r => r.kind === 'Milk');
    const matRows = dayRows.filter(r => r.kind === 'Material');
    const payRows = dayRows.filter(r => r.kind === 'Payment' || r.kind === 'Refund');
    const otherRows = dayRows.filter(r => r.kind !== 'Milk' && r.kind !== 'Material' && r.kind !== 'Payment' && r.kind !== 'Refund');

    const milkLitres = money(milkRows.reduce((sum, r) => sum + Number(r.litres || 0), 0));
    const milkCredit = money(milkRows.reduce((sum, r) => sum + r.credit, 0));
    const milkDetails = milkRows.length
      ? `${milkLitres}L (${milkRows.map(r => r.description.replace(/^Milk\s+/i, '')).join(', ')})`
      : '';

    const matCredit = money(matRows.reduce((sum, r) => sum + r.credit, 0));
    const matDetails = matRows.map(r => r.description).join(', ');

    const paymentDebit = money(payRows.reduce((sum, r) => sum + r.debit, 0));
    const paymentDetails = payRows.map(r => `${r.description}${r.mode ? ` (${r.mode})` : ''}`).join(', ');

    const otherCredit = money(otherRows.reduce((sum, r) => sum + r.credit, 0));
    const otherDebit = money(otherRows.reduce((sum, r) => sum + r.debit, 0));

    const dayCredit = money(milkCredit + matCredit + otherCredit);
    const dayDebit = money(paymentDebit + otherDebit);
    const runningBalance = dayRows[dayRows.length - 1].runningBalance;

    return {
      date,
      milkLitres,
      milkCredit,
      milkDetails,
      materialCredit: matCredit,
      materialDetails: matDetails,
      paymentDebit,
      paymentDetails,
      otherCredit,
      otherDebit,
      dayCredit,
      dayDebit,
      runningBalance
    };
  });
}

const PRINT_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@500;700;800&display=swap');

  @page {
    size: A4 portrait;
    margin: 8mm 10mm 10mm 10mm;
  }
  * {
    box-sizing: border-box;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }
  body {
    margin: 0;
    padding: 0;
    color: #0f172a;
    background: #ffffff;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    font-size: 10px;
    line-height: 1.35;
    -webkit-font-smoothing: antialiased;
  }

  /* Screen Floating Toolbar (Hidden when printing) */
  .screen-toolbar {
    position: sticky;
    top: 0;
    z-index: 9999;
    background: #0f172a;
    color: #f8fafc;
    padding: 10px 20px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    box-shadow: 0 4px 16px rgba(15,23,42,0.25);
    margin-bottom: 20px;
    border-bottom: 1px solid #1e293b;
  }
  .toolbar-left {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .toolbar-app-badge {
    background: #1e293b;
    border: 1px solid #334155;
    color: #38bdf8;
    font-size: 9px;
    font-weight: 800;
    padding: 3px 8px;
    border-radius: 4px;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }
  .toolbar-title {
    font-size: 13px;
    font-weight: 700;
    letter-spacing: -0.01em;
  }
  .toolbar-right {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .btn-ui {
    border: none;
    border-radius: 6px;
    padding: 7px 16px;
    font-size: 11px;
    font-weight: 700;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-family: inherit;
    transition: all 0.15s ease;
  }
  .btn-print {
    background: #059669;
    color: #ffffff;
    box-shadow: 0 2px 6px rgba(5,150,105,0.3);
  }
  .btn-print:hover { background: #047857; }
  .btn-close {
    background: #334155;
    color: #f8fafc;
  }
  .btn-close:hover { background: #475569; }

  @media print {
    .screen-toolbar { display: none !important; }
    body { padding: 0 !important; }
  }

  /* Document Master Container */
  .doc-container {
    max-width: 820px;
    margin: 0 auto;
    padding: 0 2px;
  }

  /* Corporate Letterhead */
  .letterhead-bar {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    padding-bottom: 10px;
    border-bottom: 2.5px solid #0f172a;
    gap: 16px;
  }
  .brand-group {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .brand-seal {
    width: 44px;
    height: 44px;
    background: #0f172a;
    color: #ffffff;
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 20px;
    font-weight: 900;
    letter-spacing: -0.05em;
    border: 1.5px solid #334155;
    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
  }
  .brand-text h1 {
    margin: 0;
    font-size: 20px;
    font-weight: 900;
    letter-spacing: -0.02em;
    color: #0f172a;
    text-transform: uppercase;
    line-height: 1.1;
  }
  .brand-text .brand-tagline {
    font-size: 9.5px;
    font-weight: 700;
    color: #059669;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    margin-top: 2px;
  }
  .brand-text .brand-contact {
    font-size: 9px;
    color: #64748b;
    margin-top: 3px;
    font-weight: 500;
  }

  .doc-info-block {
    text-align: right;
  }
  .doc-main-badge {
    display: inline-block;
    background: #0f172a;
    color: #ffffff;
    padding: 4px 10px;
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    border-radius: 4px;
  }
  .doc-info-table {
    margin-top: 4px;
    font-size: 9px;
    color: #475569;
    display: flex;
    flex-direction: column;
    gap: 1.5px;
  }
  .doc-info-table strong {
    color: #0f172a;
    font-weight: 700;
  }

  /* Supplier & Statement Parameters Grid */
  .profile-grid {
    margin-top: 8px;
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    background: #f8fafc;
    display: grid;
    grid-template-columns: 2.2fr 1.6fr 1.6fr;
    overflow: hidden;
  }
  .profile-col {
    padding: 8px 12px;
    border-right: 1px solid #e2e8f0;
  }
  .profile-col:last-child {
    border-right: none;
  }
  .section-label {
    font-size: 8px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #64748b;
    margin-bottom: 2px;
  }
  .profile-name {
    font-size: 14px;
    font-weight: 800;
    color: #0f172a;
    line-height: 1.2;
  }
  .profile-meta {
    font-size: 9px;
    color: #475569;
    margin-top: 2px;
    font-weight: 500;
  }
  .profile-meta span {
    font-weight: 700;
    color: #0f172a;
  }

  /* Status Badges */
  .status-badge {
    display: inline-block;
    padding: 3px 8px;
    border-radius: 4px;
    font-size: 10.5px;
    font-weight: 900;
    letter-spacing: 0.03em;
    text-transform: uppercase;
    margin-top: 2px;
  }
  .status-payable {
    background: #fef3c7;
    color: #92400e;
    border: 1px solid #fde68a;
  }
  .status-advance {
    background: #d1fae5;
    color: #065f46;
    border: 1px solid #a7f3d0;
  }
  .status-settled {
    background: #e2e8f0;
    color: #334155;
    border: 1px solid #cbd5e1;
  }

  /* Executive 4-Card Summary */
  .kpi-row {
    margin-top: 6px;
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 6px;
  }
  .kpi-box {
    background: #ffffff;
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    padding: 6px 10px;
    border-top: 3px solid #64748b;
  }
  .kpi-box.kpi-credit { border-top-color: #b45309; }
  .kpi-box.kpi-debit { border-top-color: #047857; }
  .kpi-box.kpi-balance { border-top-color: #0f172a; background: #fafbfc; }

  .kpi-box-title {
    font-size: 8px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #64748b;
  }
  .kpi-box-amount {
    font-family: 'JetBrains Mono', Consolas, monospace;
    font-size: 13px;
    font-weight: 800;
    color: #0f172a;
    margin-top: 2px;
    letter-spacing: -0.02em;
  }
  .kpi-box-sub {
    font-size: 8px;
    font-weight: 600;
    color: #64748b;
    margin-top: 1px;
  }

  /* Milk Analytics Data Strip */
  .metrics-strip {
    margin-top: 6px;
    background: #f1f5f9;
    border: 1px solid #cbd5e1;
    border-radius: 5px;
    padding: 5px 10px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 9px;
  }
  .metric-item {
    display: flex;
    gap: 4px;
    align-items: center;
  }
  .metric-label {
    color: #64748b;
    text-transform: uppercase;
    font-size: 8px;
    font-weight: 700;
  }
  .metric-value {
    font-family: 'JetBrains Mono', Consolas, monospace;
    font-weight: 800;
    color: #0f172a;
  }

  /* Main Accounting Ledger Table */
  table.ledger-data-table {
    width: 100%;
    border-collapse: collapse;
    margin-top: 8px;
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    overflow: hidden;
    font-size: 9.5px;
  }
  table.ledger-data-table thead {
    display: table-header-group;
  }
  table.ledger-data-table th {
    background: #0f172a;
    color: #f8fafc;
    font-size: 8.5px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 6px 7px;
    border-right: 1px solid #334155;
    text-align: left;
    vertical-align: middle;
  }
  table.ledger-data-table th:last-child {
    border-right: none;
  }
  table.ledger-data-table td {
    padding: 5px 7px;
    border-bottom: 1px solid #e2e8f0;
    border-right: 1px solid #f1f5f9;
    vertical-align: top;
  }
  table.ledger-data-table td:last-child {
    border-right: none;
  }
  table.ledger-data-table tr {
    page-break-inside: avoid;
  }
  table.ledger-data-table tbody tr:nth-child(even) td {
    background-color: #fafbfc;
  }

  .col-num {
    text-align: right;
    font-family: 'JetBrains Mono', Consolas, monospace;
    font-weight: 700;
    white-space: nowrap;
  }
  .col-center { text-align: center; }
  .col-date {
    white-space: nowrap;
    font-weight: 600;
    color: #334155;
  }
  .text-cr { color: #b45309; }
  .text-dr { color: #047857; }

  /* Type Badges */
  .tag-badge {
    display: inline-block;
    padding: 1.5px 5px;
    border-radius: 3px;
    font-size: 8px;
    font-weight: 800;
    letter-spacing: 0.03em;
    text-transform: uppercase;
  }
  .tag-milk { background: #e0f2fe; color: #0369a1; border: 1px solid #bae6fd; }
  .tag-payment { background: #dcfce7; color: #15803d; border: 1px solid #bbf7d0; }
  .tag-material { background: #f3e8ff; color: #7e22ce; border: 1px solid #e9d5ff; }
  .tag-advance { background: #ffedd5; color: #c2410c; border: 1px solid #fed7aa; }
  .tag-refund { background: #fef9c3; color: #a16207; border: 1px solid #fef08a; }
  .tag-charge { background: #fee2e2; color: #b91c1c; border: 1px solid #fecaca; }

  .desc-head {
    font-weight: 700;
    color: #0f172a;
  }
  .desc-sub {
    font-size: 8.5px;
    color: #64748b;
    margin-top: 1px;
    font-weight: 500;
  }

  .bal-cell {
    display: inline-flex;
    align-items: center;
    justify-content: flex-end;
    gap: 4px;
    width: 100%;
  }
  .flag-badge {
    font-size: 7.5px;
    font-weight: 900;
    padding: 1px 3.5px;
    border-radius: 2px;
    text-transform: uppercase;
  }
  .flag-cr { background: #fef3c7; color: #92400e; border: 1px solid #fde68a; }
  .flag-dr { background: #d1fae5; color: #065f46; border: 1px solid #a7f3d0; }
  .flag-set { background: #f1f5f9; color: #475569; border: 1px solid #e2e8f0; }

  /* Totals Footer */
  table.ledger-data-table tfoot td {
    background: #f1f5f9;
    font-weight: 800;
    border-top: 1.5px solid #0f172a;
    border-bottom: 3px double #0f172a;
    padding: 6px 7px;
    font-size: 10px;
  }

  /* Signatures Authorization Grid */
  .signatures-grid {
    margin-top: 32px;
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 20px;
    page-break-inside: avoid;
  }
  .signature-box {
    border-top: 1.5px solid #0f172a;
    padding-top: 5px;
    text-align: center;
  }
  .signature-label {
    font-size: 9px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #0f172a;
  }
  .signature-hint {
    font-size: 8px;
    color: #64748b;
    margin-top: 1px;
  }

  /* Document Disclaimer */
  .doc-legal-footer {
    margin-top: 16px;
    padding-top: 6px;
    border-top: 1px dashed #cbd5e1;
    font-size: 8px;
    color: #64748b;
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-weight: 500;
  }

  /* Voucher Styles (Payment / Receipt) */
  .voucher-card {
    border: 1.5px solid #0f172a;
    border-radius: 8px;
    padding: 16px 20px;
    margin-top: 10px;
    background: #ffffff;
  }
  .voucher-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    padding-bottom: 12px;
    border-bottom: 2px solid #0f172a;
  }
  .voucher-title {
    font-size: 18px;
    font-weight: 900;
    color: #0f172a;
    text-transform: uppercase;
    letter-spacing: -0.01em;
  }
  .voucher-ref {
    font-size: 10px;
    color: #64748b;
    margin-top: 2px;
  }
  .voucher-amount-box {
    background: #f8fafc;
    border: 1.5px solid #0f172a;
    border-radius: 6px;
    padding: 8px 16px;
    text-align: right;
  }
  .voucher-amount-label {
    font-size: 8.5px;
    font-weight: 800;
    text-transform: uppercase;
    color: #64748b;
  }
  .voucher-amount-val {
    font-family: 'JetBrains Mono', Consolas, monospace;
    font-size: 20px;
    font-weight: 900;
    color: #0f172a;
    line-height: 1.1;
    margin-top: 2px;
  }
  .voucher-table {
    width: 100%;
    margin-top: 12px;
    border-collapse: collapse;
    font-size: 10px;
  }
  .voucher-table td {
    padding: 6px 8px;
    border-bottom: 1px solid #e2e8f0;
  }
  .voucher-table td.col-head {
    width: 130px;
    font-weight: 700;
    color: #475569;
    text-transform: uppercase;
    font-size: 8.5px;
    letter-spacing: 0.04em;
    background: #f8fafc;
    border-right: 1px solid #e2e8f0;
  }
  .voucher-table td.col-val {
    font-weight: 600;
    color: #0f172a;
  }
  .voucher-signs {
    margin-top: 36px;
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 16px;
  }
`;

function documentHtml(title: string, body: string) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)}</title>
  <style>${PRINT_CSS}</style>
</head>
<body>
  ${body}
</body>
</html>`;
}

export function openPrintWindow(title: string, body: string) {
  const popup = window.open('', '_blank', 'width=1020,height=800');
  if (!popup) return false;
  popup.document.open();
  popup.document.write(documentHtml(title, body));
  popup.document.close();
  popup.focus();
  setTimeout(() => popup.print(), 350);
  return true;
}

function companyBlock(company: StatementCompany, subtitle = 'Commercial Dairy Farming & Bulk Procurement') {
  const compName = (company.name || 'Mooco Dairy').trim();
  const initial = compName.charAt(0).toUpperCase() || 'M';
  return `
    <div class="brand-group">
      <div class="brand-seal">${escapeHtml(initial)}</div>
      <div class="brand-text">
        <h1>${escapeHtml(compName)}</h1>
        <div class="brand-tagline">${escapeHtml(subtitle)}</div>
        <div class="brand-contact">${escapeHtml([company.address, company.phone].filter(Boolean).join(' • '))}</div>
      </div>
    </div>
  `;
}

export interface PrintSupplierLedgerOptions {
  company: StatementCompany;
  supplier: StatementSupplier;
  statement: SupplierStatement;
  typeFilter?: LedgerTypeFilter;
  viewMode?: 'detailed' | 'daily_summary';
  filterLabel?: string;
  notes?: string;
}

export function printSupplierLedger(input: PrintSupplierLedgerOptions) {
  const { company, supplier, statement } = input;
  const location = [supplier.village, supplier.city, supplier.address].filter(Boolean).join(', ');
  const viewMode = input.viewMode || 'detailed';
  const filterLabel = input.filterLabel || (input.typeFilter && input.typeFilter !== 'All' ? `${input.typeFilter} · ${statement.rangeLabel}` : statement.rangeLabel);
  const printDate = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const printTime = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

  let tableRows = '';
  let theadHtml = '';

  if (viewMode === 'daily_summary') {
    const summaries = buildDailySummary(statement.printRows);
    theadHtml = `
      <thead>
        <tr>
          <th style="width: 28px;" class="col-center">#</th>
          <th style="width: 90px;">Date</th>
          <th>Daily Summary & Particulars</th>
          <th class="col-num" style="width: 95px;">Supply / Cr (Rs)</th>
          <th class="col-num" style="width: 95px;">Paid / Dr (Rs)</th>
          <th class="col-num" style="width: 110px;">Balance (Rs)</th>
        </tr>
      </thead>
    `;

    tableRows = summaries.length ? summaries.map((row, idx) => `
      <tr>
        <td class="col-center font-bold" style="color: #64748b;">${idx + 1}</td>
        <td class="col-date">${escapeHtml(formatLedgerDate(row.date, true))}</td>
        <td>
          ${row.milkCredit > 0 ? `<div class="desc-head">Milk Supply: ${escapeHtml(row.milkDetails)}</div>` : ''}
          ${row.materialCredit > 0 ? `<div class="desc-sub">Materials / Feed: ${escapeHtml(row.materialDetails)}</div>` : ''}
          ${row.paymentDebit > 0 ? `<div class="desc-sub font-semibold text-dr">Payment Issued: ${escapeHtml(row.paymentDetails)}</div>` : ''}
        </td>
        <td class="col-num text-cr">${row.dayCredit > 0 ? escapeHtml(formatMoney(row.dayCredit)) : '—'}</td>
        <td class="col-num text-dr">${row.dayDebit > 0 ? escapeHtml(formatMoney(row.dayDebit)) : '—'}</td>
        <td class="col-num">
          <div class="bal-cell">
            <span>${escapeHtml(formatMoney(Math.abs(row.runningBalance)))}</span>
            <span class="flag-badge ${row.runningBalance > 0.5 ? 'flag-cr' : row.runningBalance < -0.5 ? 'flag-dr' : 'flag-set'}">
              ${row.runningBalance > 0.5 ? 'Cr' : row.runningBalance < -0.5 ? 'Dr' : 'Nil'}
            </span>
          </div>
        </td>
      </tr>
    `).join('') : `<tr><td colspan="6" class="col-center" style="padding: 24px; color: #94a3b8;">No ledger records found in this period.</td></tr>`;
  } else {
    theadHtml = `
      <thead>
        <tr>
          <th style="width: 26px;" class="col-center">#</th>
          <th style="width: 85px;">Date</th>
          <th style="width: 80px;" class="col-center">Type</th>
          <th>Particulars & Reference Narration</th>
          <th class="col-num" style="width: 95px;">Supply / Cr (Rs)</th>
          <th class="col-num" style="width: 95px;">Paid / Dr (Rs)</th>
          <th class="col-num" style="width: 110px;">Balance (Rs)</th>
        </tr>
      </thead>
    `;

    tableRows = statement.printRows.length ? statement.printRows.map((row, idx) => {
      const typeBadgeClass =
        row.kind === 'Milk' ? 'tag-milk' :
        row.kind === 'Material' ? 'tag-material' :
        row.subtype === 'Advance' ? 'tag-advance' :
        row.kind === 'Refund' ? 'tag-refund' :
        row.kind === 'Charge' ? 'tag-charge' : 'tag-payment';
      const typeLabel = row.subtype === 'Advance' ? 'Advance' : row.kind;
      return `
        <tr>
          <td class="col-center font-bold" style="color: #64748b;">${idx + 1}</td>
          <td class="col-date">${escapeHtml(formatLedgerDate(row.date))}</td>
          <td class="col-center"><span class="tag-badge ${typeBadgeClass}">${escapeHtml(typeLabel)}</span></td>
          <td>
            <div class="desc-head">${escapeHtml(row.description)}</div>
            ${row.note ? `<div class="desc-sub">Memo: ${escapeHtml(row.note)}</div>` : ''}
            ${row.accountName ? `<div class="desc-sub">Account: ${escapeHtml(row.accountName)}</div>` : ''}
          </td>
          <td class="col-num text-cr">${row.credit > 0 ? escapeHtml(formatMoney(row.credit)) : '—'}</td>
          <td class="col-num text-dr">${row.debit > 0 ? escapeHtml(formatMoney(row.debit)) : '—'}</td>
          <td class="col-num">
            <div class="bal-cell">
              <span>${escapeHtml(formatMoney(Math.abs(row.runningBalance)))}</span>
              <span class="flag-badge ${row.runningBalance > 0.5 ? 'flag-cr' : row.runningBalance < -0.5 ? 'flag-dr' : 'flag-set'}">
                ${row.runningBalance > 0.5 ? 'Cr' : row.runningBalance < -0.5 ? 'Dr' : 'Nil'}
              </span>
            </div>
          </td>
        </tr>
      `;
    }).join('') : `<tr><td colspan="7" class="col-center" style="padding: 24px; color: #94a3b8;">No ledger entries found in this period.</td></tr>`;
  }

  const milkAnalyticsHtml = (statement.milkStats && statement.milkStats.totalLitres > 0) ? `
    <div class="metrics-strip">
      <div class="metric-item"><span class="metric-label">Milk Volume:</span> <strong class="metric-value">${statement.milkStats.totalLitres.toLocaleString()} L</strong></div>
      <div class="metric-item"><span class="metric-label">Morning:</span> <strong class="metric-value">${statement.milkStats.morningLitres.toLocaleString()} L</strong></div>
      <div class="metric-item"><span class="metric-label">Evening:</span> <strong class="metric-value">${statement.milkStats.eveningLitres.toLocaleString()} L</strong></div>
      <div class="metric-item"><span class="metric-label">Avg Rate:</span> <strong class="metric-value">Rs ${statement.milkStats.avgRate}/L</strong></div>
      ${statement.milkStats.avgFat > 0 ? `<div class="metric-item"><span class="metric-label">Avg Fat:</span> <strong class="metric-value">${statement.milkStats.avgFat}%</strong></div>` : ''}
      ${statement.milkStats.avgSnf > 0 ? `<div class="metric-item"><span class="metric-label">Avg SNF:</span> <strong class="metric-value">${statement.milkStats.avgSnf}%</strong></div>` : ''}
    </div>
  ` : '';

  const body = `
    <div class="no-print screen-toolbar">
      <div class="toolbar-left">
        <span class="toolbar-app-badge">Official Accounting</span>
        <span class="toolbar-title">${escapeHtml(company.name || 'Mooco Dairy')} — Supplier Statement of Account</span>
      </div>
      <div class="toolbar-right">
        <button class="btn-ui btn-print" onclick="window.print()">
          Print Statement
        </button>
        <button class="btn-ui btn-close" onclick="window.close()">
          Close
        </button>
      </div>
    </div>

    <div class="doc-container">
      <div class="letterhead-bar">
        ${companyBlock(company)}
        <div class="doc-info-block">
          <div class="doc-main-badge">Supplier Statement of Account</div>
          <div class="doc-info-table">
            <div>Ref: <strong>#SUP-${escapeHtml(supplier.id.slice(0, 8).toUpperCase())}</strong></div>
            <div>Period: <strong>${escapeHtml(filterLabel)}</strong></div>
            <div>Date: <strong>${escapeHtml(printDate)} ${escapeHtml(printTime)}</strong></div>
          </div>
        </div>
      </div>

      <div class="profile-grid">
        <div class="profile-col">
          <div class="section-label">Supplier Profile / Account Title</div>
          <div class="profile-name">${escapeHtml(supplier.name)}</div>
          <div class="profile-meta">
            Phone: <span>${escapeHtml(supplier.phone || supplier.whatsapp || 'Not recorded')}</span>
            ${location ? ` • Location: <span>${escapeHtml(location)}</span>` : ''}
          </div>
        </div>

        <div class="profile-col">
          <div class="section-label">Statement Parameters</div>
          <div class="profile-meta">Scope: <span>${viewMode === 'daily_summary' ? 'Daily Consolidated Summary' : 'Itemized Chronological'}</span></div>
          <div class="profile-meta">Filter: <span>${escapeHtml(input.typeFilter || 'All Records')}</span></div>
          <div class="profile-meta">Entries: <span>${statement.printRows.length} transactions</span></div>
        </div>

        <div class="profile-col" style="text-align: right;">
          <div class="section-label">Net Balance Position</div>
          <div class="status-badge ${statement.closingBalance > 0.5 ? 'status-payable' : statement.closingBalance < -0.5 ? 'status-advance' : 'status-settled'}">
            ${statement.closingBalance > 0.5 ? `Payable: ${escapeHtml(formatMoney(statement.closingBalance))}` : statement.closingBalance < -0.5 ? `Advance: ${escapeHtml(formatMoney(Math.abs(statement.closingBalance)))}` : 'Account Settled'}
          </div>
        </div>
      </div>

      <div class="kpi-row">
        <div class="kpi-box">
          <div class="kpi-box-title">Opening Balance</div>
          <div class="kpi-box-amount">${escapeHtml(formatMoney(Math.abs(statement.openingBalance)))}</div>
          <div class="kpi-box-sub">${statement.openingBalance > 0.5 ? 'Payable (Cr)' : statement.openingBalance < -0.5 ? 'Advance (Dr)' : 'Settled balance'}</div>
        </div>
        <div class="kpi-box kpi-credit">
          <div class="kpi-box-title">Total Supplies (Cr)</div>
          <div class="kpi-box-amount text-cr">${escapeHtml(formatMoney(statement.totalCredit))}</div>
          <div class="kpi-box-sub">${statement.totalMilkLitres > 0 ? `${escapeHtml(statement.totalMilkLitres.toLocaleString())} L milk supplied` : 'Goods / Supplies'}</div>
        </div>
        <div class="kpi-box kpi-debit">
          <div class="kpi-box-title">Total Payments (Dr)</div>
          <div class="kpi-box-amount text-dr">${escapeHtml(formatMoney(statement.netPaid))}</div>
          <div class="kpi-box-sub">${statement.paymentCount} disbursements recorded</div>
        </div>
        <div class="kpi-box kpi-balance">
          <div class="kpi-box-title">Closing Balance</div>
          <div class="kpi-box-amount" style="color: ${statement.closingBalance > 0.5 ? '#b45309' : statement.closingBalance < -0.5 ? '#047857' : '#0f172a'};">
            ${escapeHtml(formatMoney(Math.abs(statement.closingBalance)))}
          </div>
          <div class="kpi-box-sub font-bold" style="color: ${statement.closingBalance > 0.5 ? '#b45309' : statement.closingBalance < -0.5 ? '#047857' : '#64748b'};">
            ${statement.closingBalance > 0.5 ? 'Net Payable to Supplier' : statement.closingBalance < -0.5 ? 'Advance Held by Supplier' : 'Nil / Fully Settled'}
          </div>
        </div>
      </div>

      ${milkAnalyticsHtml}

      <table class="ledger-data-table">
        ${theadHtml}
        <tbody>
          ${tableRows}
        </tbody>
        <tfoot>
          <tr>
            <td colspan="${viewMode === 'daily_summary' ? 3 : 4}" style="text-align: right; text-transform: uppercase; font-size: 9px; letter-spacing: 0.05em;">
              Grand Totals:
            </td>
            <td class="col-num text-cr">${escapeHtml(formatMoney(statement.totalCredit))}</td>
            <td class="col-num text-dr">${escapeHtml(formatMoney(statement.netPaid))}</td>
            <td class="col-num">${escapeHtml(balancePhrase(statement.closingBalance))}</td>
          </tr>
        </tfoot>
      </table>

      <div class="signatures-grid">
        <div class="signature-box">
          <div class="signature-label">Prepared by</div>
          <div class="signature-hint">Accounts Department</div>
        </div>
        <div class="signature-box">
          <div class="signature-label">Verified & Audited by</div>
          <div class="signature-hint">Finance / Operations Manager</div>
        </div>
        <div class="signature-box">
          <div class="signature-label">Supplier Acknowledgement</div>
          <div class="signature-hint">Signature / Thumb Impression</div>
        </div>
      </div>

      <div class="doc-legal-footer">
        <span>Official Computer-Generated Financial Statement &bull; Mooco Dairy ERP &bull; E. & O.E.</span>
        <span>Generated: ${escapeHtml(printDate)} at ${escapeHtml(printTime)}</span>
      </div>
    </div>
  `;

  return openPrintWindow(`Ledger - ${supplier.name}`, body);
}

export function printPaymentRegister(input: {
  company: StatementCompany;
  title: string;
  period: string;
  days: CashDay[];
  net: number;
  cashOut: number;
  cashIn: number;
  showSupplier?: boolean;
}) {
  const printDate = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const printTime = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

  const bodyRows = input.days.map(day => `
    <tr style="background: #f1f5f9; font-weight: 800;">
      <td colspan="${input.showSupplier ? 5 : 4}" style="color: #0f172a; padding: 6px 8px;">
        ${escapeHtml(formatLedgerDate(day.date, true))}
      </td>
      <td class="col-num" style="padding: 6px 8px;">${escapeHtml(formatMoney(day.net))}</td>
    </tr>
    ${day.rows.map((row, idx) => `
      <tr>
        <td class="col-center" style="color: #94a3b8; width: 30px;">${idx + 1}</td>
        ${input.showSupplier ? `<td style="font-weight: 700; color: #0f172a;">${escapeHtml(row.supplierName)}</td>` : ''}
        <td>
          <div class="desc-head">${escapeHtml(row.subtype)} &bull; ${escapeHtml(row.mode)}${row.accountName ? ` &bull; ${escapeHtml(row.accountName)}` : ''}</div>
          ${row.note ? `<div class="desc-sub">Memo: ${escapeHtml(row.note)}</div>` : ''}
        </td>
        <td class="col-num text-dr">${row.direction === 'out' ? escapeHtml(formatMoney(row.amount)) : '—'}</td>
        <td class="col-num text-cr">${row.direction === 'in' ? escapeHtml(formatMoney(row.amount)) : '—'}</td>
        <td class="col-num"></td>
      </tr>
    `).join('')}
  `).join('');

  const body = `
    <div class="no-print screen-toolbar">
      <div class="toolbar-left">
        <span class="toolbar-app-badge">Official Accounting</span>
        <span class="toolbar-title">${escapeHtml(input.company?.name || 'Mooco Dairy')} — Payment Register</span>
      </div>
      <div class="toolbar-right">
        <button class="btn-ui btn-print" onclick="window.print()">
          Print Register
        </button>
        <button class="btn-ui btn-close" onclick="window.close()">
          Close
        </button>
      </div>
    </div>

    <div class="doc-container">
      <div class="letterhead-bar">
        ${companyBlock(input.company)}
        <div class="doc-info-block">
          <div class="doc-main-badge">${escapeHtml(input.title)}</div>
          <div class="doc-info-table">
            <div>Period: <strong>${escapeHtml(input.period)}</strong></div>
            <div>Date: <strong>${escapeHtml(printDate)} ${escapeHtml(printTime)}</strong></div>
          </div>
        </div>
      </div>

      <div class="kpi-row" style="margin-top: 10px;">
        <div class="kpi-box kpi-debit">
          <div class="kpi-box-title">Total Paid Out (Dr)</div>
          <div class="kpi-box-amount text-dr">${escapeHtml(formatMoney(input.cashOut))}</div>
          <div class="kpi-box-sub">Disbursements</div>
        </div>
        <div class="kpi-box kpi-credit">
          <div class="kpi-box-title">Total Refunds In (Cr)</div>
          <div class="kpi-box-amount text-cr">${escapeHtml(formatMoney(input.cashIn))}</div>
          <div class="kpi-box-sub">Cash Recoveries</div>
        </div>
        <div class="kpi-box kpi-balance">
          <div class="kpi-box-title">Net Cash Disbursed</div>
          <div class="kpi-box-amount">${escapeHtml(formatMoney(input.net))}</div>
          <div class="kpi-box-sub">Net Outflow</div>
        </div>
        <div class="kpi-box">
          <div class="kpi-box-title">Active Days</div>
          <div class="kpi-box-amount">${input.days.length} Days</div>
          <div class="kpi-box-sub">Disbursement sessions</div>
        </div>
      </div>

      <table class="ledger-data-table" style="margin-top: 10px;">
        <thead>
          <tr>
            <th style="width: 30px;" class="col-center">#</th>
            ${input.showSupplier ? '<th>Supplier Account</th>' : ''}
            <th>Transaction Particulars & Account</th>
            <th class="col-num" style="width: 100px;">Paid Out (Dr)</th>
            <th class="col-num" style="width: 100px;">Refund In (Cr)</th>
            <th class="col-num" style="width: 110px;">Daily Net</th>
          </tr>
        </thead>
        <tbody>
          ${bodyRows || `<tr><td colspan="6" class="col-center" style="padding: 24px; color: #94a3b8;">No payment entries recorded in this period.</td></tr>`}
        </tbody>
      </table>

      <div class="signatures-grid">
        <div class="signature-box">
          <div class="signature-label">Prepared by</div>
          <div class="signature-hint">Accounts Officer</div>
        </div>
        <div class="signature-box">
          <div class="signature-label">Cashier / Disbursed by</div>
          <div class="signature-hint">Treasury / Cash Desk</div>
        </div>
        <div class="signature-box">
          <div class="signature-label">Audited & Approved by</div>
          <div class="signature-hint">Finance Controller</div>
        </div>
      </div>

      <div class="doc-legal-footer">
        <span>Mooco Dairy ERP &bull; Official Payment Register &bull; E. & O.E.</span>
        <span>Generated: ${escapeHtml(printDate)} at ${escapeHtml(printTime)}</span>
      </div>
    </div>
  `;
  return openPrintWindow(input.title, body);
}

export function printPaymentVoucher(input: {
  company: StatementCompany;
  line: CashLine;
  balancePhrase?: string;
}) {
  const line = input.line;
  const isRefund = line.direction === 'in';
  const voucherTitle = isRefund ? 'Cash Refund Voucher' : 'Cash Disbursement Voucher';
  const voucherRef = `#PV-${line.id.slice(0, 8).toUpperCase()}`;
  const printDate = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const printTime = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

  const body = `
    <div class="no-print screen-toolbar">
      <div class="toolbar-left">
        <span class="toolbar-app-badge">Official Accounting</span>
        <span class="toolbar-title">${escapeHtml(input.company?.name || 'Mooco Dairy')} — ${escapeHtml(voucherTitle)}</span>
      </div>
      <div class="toolbar-right">
        <button class="btn-ui btn-print" onclick="window.print()">
          Print Voucher
        </button>
        <button class="btn-ui btn-close" onclick="window.close()">
          Close
        </button>
      </div>
    </div>

    <div class="doc-container">
      <div class="voucher-card">
        <div class="voucher-header">
          ${companyBlock(input.company)}
          <div style="text-align: right;">
            <div class="voucher-title">${escapeHtml(voucherTitle)}</div>
            <div class="voucher-ref">Voucher No: <strong>${escapeHtml(voucherRef)}</strong></div>
            <div class="voucher-ref">Date: <strong>${escapeHtml(formatLedgerDate(line.date, true))}</strong></div>
          </div>
        </div>

        <div style="margin-top: 14px; display: flex; justify-content: space-between; align-items: flex-end; gap: 20px;">
          <div style="flex: 1;">
            <div class="section-label">Paid To / Beneficiary Account</div>
            <div style="font-size: 16px; font-weight: 900; color: #0f172a;">${escapeHtml(line.supplierName)}</div>
            <div style="font-size: 9.5px; color: #475569; margin-top: 2px;">
              Contact: <strong>${escapeHtml(line.phone || 'Not recorded')}</strong>
            </div>
          </div>

          <div class="voucher-amount-box">
            <div class="voucher-amount-label">Voucher Net Amount</div>
            <div class="voucher-amount-val">${escapeHtml(formatMoney(line.amount))}</div>
          </div>
        </div>

        <table class="voucher-table">
          <tbody>
            <tr>
              <td class="col-head">Transaction Head</td>
              <td class="col-val">${escapeHtml(line.subtype)} (${isRefund ? 'Incoming Refund / Recovery' : 'Outgoing Payment / Advance'})</td>
            </tr>
            <tr>
              <td class="col-head">Payment Method</td>
              <td class="col-val">${escapeHtml(line.mode)}${line.accountName ? ` &bull; Disbursed via ${escapeHtml(line.accountName)}` : ''}</td>
            </tr>
            <tr>
              <td class="col-head">Particulars / Memo</td>
              <td class="col-val">${escapeHtml(line.note || 'Regular supplier payment settlement')}</td>
            </tr>
            ${input.balancePhrase ? `
              <tr>
                <td class="col-head">Supplier Net Balance</td>
                <td class="col-val font-bold" style="color: #0f172a;">${escapeHtml(input.balancePhrase)}</td>
              </tr>
            ` : ''}
          </tbody>
        </table>

        <div class="voucher-signs">
          <div class="signature-box">
            <div class="signature-label">Prepared by</div>
            <div class="signature-hint">Accounts Officer</div>
          </div>
          <div class="signature-box">
            <div class="signature-label">Authorized by</div>
            <div class="signature-hint">Finance Manager</div>
          </div>
          <div class="signature-box">
            <div class="signature-label">Cashier / Disbursed</div>
            <div class="signature-hint">Cashier Desk</div>
          </div>
          <div class="signature-box">
            <div class="signature-label">Receiver Signature</div>
            <div class="signature-hint">CNIC / Thumb Impression</div>
          </div>
        </div>

        <div class="doc-legal-footer" style="margin-top: 24px;">
          <span>Official Accounting Document &bull; Mooco Dairy ERP &bull; E. & O.E.</span>
          <span>Printed on ${escapeHtml(printDate)} at ${escapeHtml(printTime)}</span>
        </div>
      </div>
    </div>
  `;
  return openPrintWindow(`Voucher - ${line.supplierName}`, body);
}

export function whatsappStatementText(input: {
  companyName: string;
  supplier: StatementSupplier;
  statement: SupplierStatement;
}) {
  const { supplier, statement } = input;
  const lines = statement.entries.slice(0, 12).map(row => {
    const amount = row.debit > 0 ? `Paid ${formatMoney(row.debit)}` : formatMoney(row.credit);
    return `${formatLedgerDate(row.date)} · ${row.description} · ${amount}`;
  });
  return [
    `*${input.companyName} — Supplier Ledger Statement*`,
    `Supplier: ${supplier.name}`,
    `Period: ${statement.rangeLabel}`,
    '',
    `Opening: ${balancePhrase(statement.openingBalance)}`,
    `Milk: ${statement.totalMilkLitres} L`,
    `Supplies: ${formatMoney(statement.totalCredit)}`,
    `Paid: ${formatMoney(statement.netPaid)}`,
    `Closing: ${balancePhrase(statement.closingBalance)}`,
    lines.length ? '' : '',
    lines.length ? 'Recent entries:' : '',
    ...lines
  ].filter(Boolean).join('\n');
}
