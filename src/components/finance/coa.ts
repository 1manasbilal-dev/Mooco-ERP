import type React from 'react';
import {
  Box, Briefcase, DollarSign, FileText, Landmark, Store, TrendingDown, TrendingUp, Truck, Users, Wallet,
} from 'lucide-react';
import type {
  BankTransaction, Customer, ExpenseEntry, ExpenseVendor, FinancialAccount, InventoryItem, ItemDefinition, ManualAccount,
  MaterialPurchaseEntry, POSBill, PurchaseEntry, Supplier, DailySupplyEntry,
} from '../../types';

/**
 * Chart of Accounts tree: system control accounts worked out from the app's records plus the
 * owner's manual ledger accounts. Balances are kept positive on each account's normal side
 * (debit for assets / expenses, credit for liabilities / equity / income).
 */

export type AccountType = 'Asset' | 'Liability' | 'Equity' | 'Income' | 'Expense';

export const ACCOUNT_TYPE_ORDER: AccountType[] = ['Asset', 'Liability', 'Equity', 'Income', 'Expense'];

export interface COANode {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  balance: number;
  children?: COANode[];
  isGroup?: boolean;
  icon?: React.ElementType;
  /** System control account: worked out by the app, cannot be deleted. */
  isSystem: boolean;
  isActive?: boolean;
  /** Where to manage it. */
  sourceModule?: string;
  parentId?: string;
  reportType?: 'transaction' | 'subledger';
  subledgerType?: 'customer' | 'supplier' | 'inventory' | 'employee';
}

interface CoaSources {
  accounts: FinancialAccount[];
  inventory: InventoryItem[];
  items: ItemDefinition[];
  customers: Customer[];
  suppliers: Supplier[];
  purchases: PurchaseEntry[];
  materialPurchases: MaterialPurchaseEntry[];
  sales: POSBill[];
  dailySupplyEntries: DailySupplyEntry[];
  expenses: ExpenseEntry[];
  expenseVendors: ExpenseVendor[];
  bankTransactions: BankTransaction[];
  manualAccounts: ManualAccount[];
}

// Structural headings offered as parents in the Add form have no manual-node slot of their own;
// without this their children were never shown or totalled.
const STRUCTURAL_PARENT_IDS = new Set(['1000', '1001', '1400', '2000', '2001', '2400', '3000', '4000', '5000']);

function buildManualNodes(items: ManualAccount[], rootType: AccountType, specificParentId?: string): COANode[] {
  const buildTree = (parentId: string | undefined): COANode[] =>
    items
      .filter(item => item.parentId === parentId || (!parentId && (!item.parentId || STRUCTURAL_PARENT_IDS.has(item.parentId))))
      .filter(item => item.type === rootType)
      .map(item => {
        const children = buildTree(item.id);
        const node: COANode = {
          id: item.id,
          code: '',
          name: item.name,
          type: item.type,
          balance: item.balance,
          isSystem: false,
          isActive: item.isActive !== false,
          parentId: item.parentId,
          icon: Briefcase,
          reportType: 'transaction',
          children: children.length > 0 ? children : undefined,
          isGroup: children.length > 0,
        };
        if (node.children) node.balance += node.children.reduce((sum, c) => sum + c.balance, 0);
        return node;
      });
  return buildTree(specificParentId);
}

const sumBalances = (nodes: COANode[]) => nodes.reduce((sum, n) => sum + n.balance, 0);

export function buildChartOfAccounts({
  accounts, inventory, items, customers, suppliers, purchases, materialPurchases, sales, dailySupplyEntries, expenses, expenseVendors,
  bankTransactions, manualAccounts,
}: CoaSources): COANode[] {
  const cashBankNodes: COANode[] = (accounts || []).map((acc, idx) => ({
    id: acc.id, code: `110${idx + 1}`, name: acc.name, type: 'Asset', balance: acc.balance || 0, icon: acc.type === 'Bank' ? Landmark : Wallet,
    isSystem: true, sourceModule: 'Bank & Cash', reportType: 'transaction', isActive: acc.isActive !== false,
  }));
  const manualCashBankNodes = buildManualNodes(manualAccounts, 'Asset', '1100');
  const allCashBankNodes = [...cashBankNodes, ...manualCashBankNodes];

  const totalReceivable = customers.filter(c => c.balance > 0).reduce((sum, c) => sum + c.balance, 0);
  const arNode: COANode = { id: 'sys_ar', code: '1200', name: 'Accounts Receivable (Debtors)', type: 'Asset', balance: totalReceivable, icon: Users, isSystem: true, sourceModule: 'Customers', reportType: 'subledger', subledgerType: 'customer', isActive: true };

  // Item lookups built once: matching every stock row against the whole catalogue was O(rows × items).
  const itemsById = new Map<string, ItemDefinition>();
  const itemsByName = new Map<string, ItemDefinition>();
  for (const def of items) {
    if (!itemsById.has(def.id)) itemsById.set(def.id, def);
    if (!itemsByName.has(def.name)) itemsByName.set(def.name, def);
  }
  const totalInventoryValue = inventory.reduce((sum, inv) => {
    const itemDef = itemsById.get((inv as any).item_id) || itemsById.get(inv.id) || itemsByName.get(inv.name);
    const cost = Number(itemDef?.cost_price || 0);
    let invSum = (Number(inv.quantity) || 0) * cost;
    if (inv.variant_stocks && typeof inv.variant_stocks === 'object') {
      Object.entries(inv.variant_stocks).forEach(([varName, count]) => {
        const vCount = Number(count) || 0;
        if (vCount <= 0) return;
        // variant_stocks is keyed by variant id; matching on name always missed and valued a pack as one base unit.
        const variantDef = ((itemDef as any)?.variants || []).find((v: any) => v.id === varName || v.variantId === varName || v.name === varName);
        if (variantDef?.deduct_from_base === true) return;
        const factor = Number(variantDef?.quantity_in_base_unit || variantDef?.pack_size || 1);
        invSum += vCount * factor * cost;
      });
    }
    return sum + invSum;
  }, 0);
  const invNode: COANode = { id: 'sys_inv', code: '1300', name: 'Inventory Asset', type: 'Asset', balance: totalInventoryValue, icon: Box, isSystem: true, sourceModule: 'Inventory', reportType: 'subledger', subledgerType: 'inventory', isActive: true };

  const supplierAdvances = suppliers.reduce((sum, s) => sum + (s.pending_balance < 0 ? Math.abs(s.pending_balance) : 0), 0);
  const suppAdvNode: COANode = { id: 'sys_supp_adv', code: '1250', name: 'Supplier Advances', type: 'Asset', balance: supplierAdvances, icon: Briefcase, isSystem: true, sourceModule: 'Suppliers', reportType: 'subledger', subledgerType: 'supplier', isActive: true };

  const manualAssets = buildManualNodes(manualAccounts, 'Asset', undefined).filter(n => !['sys_ar', 'sys_inv', 'sys_supp_adv', '1100'].includes(n.parentId || ''));
  const totalAssets = sumBalances([...allCashBankNodes, arNode, invNode, suppAdvNode, ...manualAssets]);

  const supplierPayable = suppliers.reduce((sum, s) => sum + Math.max(0, s.pending_balance), 0);
  // Expense vendors keep what we still owe in pending_balance (there is no current_balance field).
  const vendorPayable = (expenseVendors || []).reduce((sum, v) => sum + Math.max(0, Number((v as any).pending_balance || 0)), 0);
  const apNode: COANode = { id: 'sys_ap', code: '2100', name: 'Accounts Payable (Creditors)', type: 'Liability', balance: supplierPayable + vendorPayable, icon: Briefcase, isSystem: true, sourceModule: 'Suppliers', reportType: 'subledger', subledgerType: 'supplier', isActive: true };
  const totalAdvances = customers.filter(c => c.balance < 0).reduce((sum, c) => sum + Math.abs(c.balance), 0);
  const advanceNode: COANode = { id: 'sys_adv', code: '2200', name: 'Unearned Revenue (Customer Adv)', type: 'Liability', balance: totalAdvances, icon: Users, isSystem: true, sourceModule: 'Customers', reportType: 'subledger', subledgerType: 'customer', isActive: true };
  const manualLiabilities = buildManualNodes(manualAccounts, 'Liability', undefined);
  const totalLiabilities = sumBalances([apNode, advanceNode, ...manualLiabilities]);

  const posRevenue = sales.filter(s => (s.status as string) !== 'Returned' && (s.status as string) !== 'Cancelled').reduce((sum, s) => {
    const refund = (s.status as string) === 'Partially Returned' ? (Number((s as any).refund_amount) || 0) : 0;
    return sum + Math.max(0, (Number(s.total) || 0) - refund);
  }, 0);
  // Loaded rows have `details` spread onto the row, so the status lives on the row itself.
  const supplyStatus = (s: any) => s.status ?? s.details?.status;
  const supplyRevenue = dailySupplyEntries
    .filter(s => supplyStatus(s) !== 'Cancelled' && supplyStatus(s) !== 'Pending')
    .reduce((sum, s) => sum + Number((s as any).total_amount || 0), 0);

  const systemSalesNodes: COANode[] = [
    { id: 'inc_pos', code: '4101', name: 'POS / Counter Sales', type: 'Income', balance: posRevenue, icon: Store, isSystem: true, sourceModule: 'Sales', reportType: 'transaction', isActive: true },
    { id: 'inc_supply', code: '4102', name: 'Daily Supply Sales', type: 'Income', balance: supplyRevenue, icon: Truck, isSystem: true, sourceModule: 'Sales', reportType: 'transaction', isActive: true },
  ];
  const allSalesChildren = [...systemSalesNodes, ...buildManualNodes(manualAccounts, 'Income', 'inc_sales_group')];
  const salesRevenueGroup: COANode = {
    id: 'inc_sales_group', code: '4100', name: 'Sales Revenue', type: 'Income', balance: sumBalances(allSalesChildren),
    isGroup: true, isSystem: true, isActive: true, icon: TrendingUp, children: allSalesChildren,
  };
  const otherManualIncome = buildManualNodes(manualAccounts, 'Income', undefined);
  const totalIncome = salesRevenueGroup.balance + sumBalances(otherManualIncome);

  const validExpenses = expenses.filter(e => (e as any).status !== 'Cancelled' && (e as any).status !== 'Returned');
  const expenseGroups = validExpenses.reduce((acc, exp) => {
    acc[exp.category] = (acc[exp.category] || 0) + Number(exp.amount || 0);
    return acc;
  }, {} as Record<string, number>);
  const opExpenseNodes: COANode[] = Object.entries(expenseGroups).map(([cat, amount], idx) => ({
    id: `exp_${cat}`, code: `510${idx + 1}`, name: `${cat} Expense`, type: 'Expense', balance: amount, icon: FileText,
    isSystem: true, sourceModule: 'Expenses', reportType: 'transaction', isActive: true,
  }));
  const notVoid = (p: any) => p.status !== 'Returned' && p.status !== 'Cancelled';
  const milkPurchaseCost = purchases.filter(notVoid).reduce((sum, p) => sum + Number((p as any).total_amount || 0), 0);
  const materialPurchaseCost = materialPurchases.filter(notVoid).reduce((sum, p) => sum + Number((p as any).total_amount || 0), 0);
  const purchaseNodes: COANode[] = [
    { id: 'cogs_milk', code: '5201', name: 'Cost of Goods - Milk', type: 'Expense', balance: milkPurchaseCost, icon: TrendingDown, isSystem: true, sourceModule: 'Purchases', reportType: 'transaction', isActive: true },
    { id: 'cogs_mat', code: '5202', name: 'Cost of Goods - Materials', type: 'Expense', balance: materialPurchaseCost, icon: TrendingDown, isSystem: true, sourceModule: 'Purchases', reportType: 'transaction', isActive: true },
  ];
  const allExpenseNodes = [...opExpenseNodes, ...purchaseNodes, ...buildManualNodes(manualAccounts, 'Expense', undefined)];
  const totalExpenses = sumBalances(allExpenseNodes);

  let capitalInjection = 0;
  let drawings = 0;
  for (const t of bankTransactions) {
    if (t.category === 'Capital Injection' || t.category === "Owner's Equity (Capital)") capitalInjection += t.amount;
    else if (t.category === 'Owner Drawings' || t.category === "Owner's Equity (Drawings)") drawings += t.amount;
  }
  const sysCapitalNode: COANode = { id: 'eq_cap_sys', code: '3100-SYS', name: 'Unallocated Capital (System)', type: 'Equity', balance: capitalInjection, icon: DollarSign, isSystem: true, sourceModule: 'Bank & Cash', reportType: 'transaction', isActive: true };
  const manualCapitalNodes = buildManualNodes(manualAccounts, 'Equity', 'sys_eq_cap_group');
  const totalCapital = capitalInjection + sumBalances(manualCapitalNodes);

  const sysDrawingsNode: COANode = { id: 'eq_draw_sys', code: '3200-SYS', name: 'Unallocated Drawings (System)', type: 'Equity', balance: -drawings, icon: DollarSign, isSystem: true, sourceModule: 'Bank & Cash', reportType: 'transaction', isActive: true };
  const manualDrawingNodes = buildManualNodes(manualAccounts, 'Equity', 'sys_eq_draw_group');
  const totalDrawings = -drawings + sumBalances(manualDrawingNodes);

  const capitalGroupNode: COANode = { id: 'sys_eq_cap_group', code: '3100', name: "Owners' Capital Accounts", type: 'Equity', balance: totalCapital, isGroup: true, isSystem: true, isActive: true, children: [sysCapitalNode, ...manualCapitalNodes] };
  const drawingsGroupNode: COANode = { id: 'sys_eq_draw_group', code: '3200', name: "Owners' Drawings Accounts", type: 'Equity', balance: totalDrawings, isGroup: true, isSystem: true, isActive: true, children: [sysDrawingsNode, ...manualDrawingNodes] };
  const otherManualEquity = buildManualNodes(manualAccounts, 'Equity', undefined).filter(n => !['sys_eq_cap_group', 'sys_eq_draw_group'].includes(n.id));
  const totalEquity = totalCapital + totalDrawings + sumBalances(otherManualEquity);

  return [
    {
      id: '1000', code: '1000', name: 'ASSETS', type: 'Asset', isGroup: true, isSystem: true, balance: totalAssets, isActive: true,
      children: [
        { id: '1100', code: '1100', name: 'Cash & Bank', type: 'Asset', isGroup: true, isSystem: true, balance: sumBalances(allCashBankNodes), isActive: true, children: allCashBankNodes },
        { id: '1001', code: '', name: 'Current Assets', type: 'Asset', isGroup: true, isSystem: true, balance: arNode.balance + invNode.balance + suppAdvNode.balance, isActive: true, children: [arNode, invNode, suppAdvNode] },
        { id: '1400', code: '1400', name: 'Fixed Assets & Others', type: 'Asset', isGroup: true, isSystem: true, balance: sumBalances(manualAssets), isActive: true, children: manualAssets },
      ],
    },
    {
      id: '2000', code: '2000', name: 'LIABILITIES', type: 'Liability', isGroup: true, isSystem: true, balance: totalLiabilities, isActive: true,
      children: [
        { id: '2001', code: '', name: 'Current Liabilities', type: 'Liability', isGroup: true, isSystem: true, balance: apNode.balance + advanceNode.balance, isActive: true, children: [apNode, advanceNode] },
        { id: '2400', code: '2400', name: 'Long Term & Other', type: 'Liability', isGroup: true, isSystem: true, balance: sumBalances(manualLiabilities), isActive: true, children: manualLiabilities },
      ],
    },
    { id: '3000', code: '3000', name: 'EQUITY', type: 'Equity', isGroup: true, isSystem: true, balance: totalEquity, isActive: true, children: [capitalGroupNode, drawingsGroupNode, ...otherManualEquity] },
    { id: '4000', code: '4000', name: 'INCOME', type: 'Income', isGroup: true, isSystem: true, balance: totalIncome, isActive: true, children: [salesRevenueGroup, ...otherManualIncome] },
    { id: '5000', code: '5000', name: 'EXPENSES', type: 'Expense', isGroup: true, isSystem: true, balance: totalExpenses, isActive: true, children: allExpenseNodes },
  ];
}

/** Keeps matching accounts and the groups above them. */
export function filterChart(nodes: COANode[], search: string, type: AccountType | 'All'): COANode[] {
  const query = search.trim().toLowerCase();
  const byType = type === 'All' ? nodes : nodes.filter(node => node.type === type);
  if (!query) return byType;
  const filterNode = (node: COANode): COANode | null => {
    const matches = node.name.toLowerCase().includes(query) || Boolean(node.code && node.code.toLowerCase().includes(query));
    const children = (node.children || []).map(filterNode).filter(Boolean) as COANode[];
    return matches || children.length > 0 ? { ...node, children } : null;
  };
  return byType.map(filterNode).filter(Boolean) as COANode[];
}

export interface FlatCoaRow {
  node: COANode;
  level: number;
  hasChildren: boolean;
  expanded: boolean;
}

/** The rows on screen, top to bottom: a node's children follow it only while it is expanded. */
export function flattenChart(nodes: COANode[], expanded: Record<string, boolean>, expandAll: boolean): FlatCoaRow[] {
  const rows: FlatCoaRow[] = [];
  const walk = (list: COANode[], level: number) => {
    for (const node of list) {
      const hasChildren = Boolean(node.children && node.children.length > 0);
      const isOpen = hasChildren && (expandAll || Boolean(expanded[node.id]));
      rows.push({ node, level, hasChildren, expanded: isOpen });
      if (isOpen) walk(node.children!, level + 1);
    }
  };
  walk(nodes, 0);
  return rows;
}

/** Every group id in the tree (for "expand all"). */
export function groupIds(nodes: COANode[]): string[] {
  const ids: string[] = [];
  const walk = (list: COANode[]) => list.forEach(node => {
    if (node.children && node.children.length > 0) {
      ids.push(node.id);
      walk(node.children);
    }
  });
  walk(nodes);
  return ids;
}

const DEBIT_NORMAL = new Set<AccountType>(['Asset', 'Expense']);

/**
 * Debit / credit side of a balance. Balances are stored positive on the account's normal side,
 * so a negative balance sits on the other side (an overdrawn bank is Cr, drawings are Dr).
 */
export function balanceSide(type: AccountType, balance: number): 'Dr' | 'Cr' | null {
  if (!balance) return null;
  const debitNormal = DEBIT_NORMAL.has(type);
  return (balance > 0) === debitNormal ? 'Dr' : 'Cr';
}

/** Ledger account ids that other records still point at (journal lines, deposit / withdrawal contra). */
export function referencedLedgerIds(
  journalEntries: Array<{ lines?: Array<{ accountId?: string; account_id?: string }> }>,
  bankTransactions: BankTransaction[],
) {
  const ids = new Set<string>();
  for (const entry of journalEntries) {
    for (const line of entry.lines || []) {
      const id = line.account_id || line.accountId;
      if (id) ids.add(id);
    }
  }
  for (const tx of bankTransactions) {
    const contra = (tx as any).details?.related_account_id || tx.related_account_id;
    if (contra) ids.add(contra);
  }
  return ids;
}

/** Mobile-wallet names, checked before "cash" so "JazzCash" becomes a Wallet, not a Cash account. */
const WALLET_WORDS = ['jazz', 'easypaisa', 'easy paisa', 'wallet', 'sadapay', 'nayapay', 'upaisa'];

/** Which cash / bank account a Chart-of-Accounts entry should become, if any. */
export function cashBankKindFor(name: string, type: AccountType, parentId?: string): 'Cash' | 'Bank' | 'Wallet' | null {
  const lower = name.toLowerCase();
  const looksCashBank = WALLET_WORDS.some(w => lower.includes(w)) || lower.includes('bank') || lower.includes('cash');
  const isCashOrBank = parentId === '1100' || (!parentId && type === 'Asset' && looksCashBank);
  if (!isCashOrBank) return null;
  if (WALLET_WORDS.some(w => lower.includes(w))) return 'Wallet';
  return lower.includes('cash') ? 'Cash' : 'Bank';
}
