import React, { useMemo, useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useDairy } from '../context/DairyContext';
import { useToast } from '../context/ToastContext';
import { 
  Landmark, ChevronDown, ChevronRight, PieChart, 
  TrendingUp, TrendingDown, DollarSign, Box, 
  Users, Briefcase, FileText, Activity, Wallet,
  Plus, Trash2, X, Lock, ArrowRight,
  PlusCircle, FileBarChart, List, BookOpen, CheckCircle, Search,
  History as HistoryIcon, Power, Store, Truck, ArrowRightLeft, 
  ArrowDownLeft, ArrowUpRight, CheckCircle2, AlertCircle, Layers, Loader2
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { ManualAccount, BankTransaction, JournalLine, FinancialAccount } from '../types';
import { formatCurrency, formatMoneyRaw } from '../lib/formatters';
import { confirmAction } from '../components/ui/ConfirmDialog';

// --- Type Fix for Framer Motion ---
const MotionDiv = motion.div as any;

// Types for our Virtual COA
type AccountType = 'Asset' | 'Liability' | 'Equity' | 'Income' | 'Expense';

interface COANode {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  balance: number;
  children?: COANode[];
  isGroup?: boolean;
  icon?: React.ElementType;
  isSystem: boolean; // Cannot be deleted
  isActive?: boolean;
  sourceModule?: string; // Where to manage it
  parentId?: string; // To track hierarchy
  reportType?: 'transaction' | 'subledger';
  subledgerType?: 'customer' | 'supplier' | 'inventory' | 'employee';
}

// Flat account interface for Dropdown
interface SelectableAccount {
  id: string;
  name: string;
  type: string; // 'Bank', 'Customer', 'Manual', etc.
  category: string; // 'Asset', 'Liability'
  balance?: number;
}

const Accounts: React.FC = () => {
  const { 
    accounts, inventory, items, customers, suppliers, 
    purchases, materialPurchases, sales, dailySupplyEntries, expenses, expenseVendors,
    bankTransactions, manualAccounts, addManualAccount, deleteManualAccount, updateManualAccount,
    addAccount, 
    addJournalEntry, journalEntries
  } = useDairy();
  
  const { showToast } = useToast();

  const location = useLocation();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState<'chart' | 'journal'>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('tab') === 'journal' ? 'journal' : 'chart';
  });

  const selectTab = (tab: 'chart' | 'journal') => {
    setActiveTab(tab);
    navigate(`/accounts?tab=${tab}`);
  };

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const tabParam = params.get('tab');
    if (tabParam === 'chart' || tabParam === 'journal') {
      setActiveTab(tabParam);
    }
  }, [location.search]);

  // --- CHART OF ACCOUNTS STATE ---
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({
    '1000': true,
    '2000': true,
    '3000': true,
    '4000': true,
    '5000': true
  });
  const [coaSearch, setCoaSearch] = useState('');
  
  // ADD MODAL STATE
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmittingJournal, setIsSubmittingJournal] = useState(false);
  
  const [newAccount, setNewAccount] = useState<Partial<ManualAccount>>({
    name: '', type: 'Liability', balance: 0, description: '', parentId: '', isActive: true
  });

  const [reportNode, setReportNode] = useState<COANode | null>(null);

  // --- JOURNAL ENTRY STATE ---
  const [journalDate, setJournalDate] = useState(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' }));
  const [journalRef, setJournalRef] = useState('');
  const [journalNarration, setJournalNarration] = useState('');
  const [journalLines, setJournalLines] = useState<JournalLine[]>([
    { id: '1', accountId: '', accountName: '', accountType: '', debit: 0, credit: 0 },
    { id: '2', accountId: '', accountName: '', accountType: '', debit: 0, credit: 0 }
  ]);

  // --- COA Logic ---
  const toggleGroup = (id: string) => { setExpandedGroups(prev => ({ ...prev, [id]: !prev[id] })); };

  // Helper to build hierarchy for manual accounts
  const buildManualNodes = (items: ManualAccount[], rootType: AccountType, specificParentId?: string): COANode[] => {
    const buildTree = (parentId: string | undefined): COANode[] => {
        return items
            .filter(item => item.parentId === parentId || (!parentId && !item.parentId))
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
                    isGroup: children.length > 0
                };
                if (node.children) {
                    node.balance += node.children.reduce((sum, c) => sum + c.balance, 0);
                }
                return node;
            });
    };

    return buildTree(specificParentId);
  };

  const chartOfAccounts = useMemo(() => {
    // Assets
    const cashBankNodes: COANode[] = (accounts || []).map((acc, idx) => ({ id: acc.id, code: `110${idx + 1}`, name: acc.name, type: 'Asset', balance: acc.balance || 0, icon: acc.type === 'Bank' ? Landmark : Wallet, isSystem: true, sourceModule: 'Bank & Cash', reportType: 'transaction', isActive: acc.isActive !== false }));
    const manualCashBankNodes = buildManualNodes(manualAccounts, 'Asset', '1100');
    const allCashBankNodes = [...cashBankNodes, ...manualCashBankNodes];
    
    const totalReceivable = customers.filter(c => c.balance > 0).reduce((sum, c) => sum + c.balance, 0);
    const arNode: COANode = { id: 'sys_ar', code: '1200', name: 'Accounts Receivable (Debtors)', type: 'Asset', balance: totalReceivable, icon: Users, isSystem: true, sourceModule: 'Customers', reportType: 'subledger', subledgerType: 'customer', isActive: true };
    const totalInventoryValue = inventory.reduce((sum, inv) => {
      const itemDef = items.find(def => def.id === (inv as any).item_id || def.id === inv.id || def.name === inv.name);
      const cost = Number(itemDef?.cost_price || 0);
      let invSum = (Number(inv.quantity) || 0) * cost;
      if (inv.variant_stocks && typeof inv.variant_stocks === 'object') {
        Object.entries(inv.variant_stocks).forEach(([varName, count]) => {
          const vCount = Number(count) || 0;
          if (vCount <= 0) return;
          const variantDef = (itemDef?.variants || []).find((v: any) => v.name === varName);
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
    const totalAssets = [...allCashBankNodes, arNode, invNode, suppAdvNode, ...manualAssets].reduce((sum, n) => sum + n.balance, 0);

    // Liabilities
    const supplierPayable = suppliers.reduce((sum, s) => sum + Math.max(0, s.pending_balance), 0);
    // Expense vendors keep what we still owe in pending_balance (there is no current_balance field).
    const vendorPayable = (expenseVendors || []).reduce((sum, v) => sum + Math.max(0, Number(v.pending_balance || 0)), 0);
    const totalPayable = supplierPayable + vendorPayable;
    const apNode: COANode = { id: 'sys_ap', code: '2100', name: 'Accounts Payable (Creditors)', type: 'Liability', balance: totalPayable, icon: Briefcase, isSystem: true, sourceModule: 'Suppliers', reportType: 'subledger', subledgerType: 'supplier', isActive: true };
    const totalAdvances = customers.filter(c => c.balance < 0).reduce((sum, c) => sum + Math.abs(c.balance), 0);
    const advanceNode: COANode = { id: 'sys_adv', code: '2200', name: 'Unearned Revenue (Customer Adv)', type: 'Liability', balance: totalAdvances, icon: Users, isSystem: true, sourceModule: 'Customers', reportType: 'subledger', subledgerType: 'customer', isActive: true };
    const manualLiabilities = buildManualNodes(manualAccounts, 'Liability', undefined);
    const totalLiabilities = [apNode, advanceNode, ...manualLiabilities].reduce((sum, n) => sum + n.balance, 0);

    // Income
    const posRevenue = sales.filter(s => s.status !== 'Returned' && s.status !== 'Cancelled').reduce((sum, s) => {
      const refund = s.status === 'Partially Returned' ? (Number(s.refund_amount) || 0) : 0;
      return sum + Math.max(0, (Number(s.total) || 0) - refund);
    }, 0);
    const supplyRevenue = dailySupplyEntries.filter(s => s.details?.status !== 'Cancelled' && s.details?.status !== 'Pending').reduce((sum, s) => sum + Number(s.total_amount || 0), 0);
    
    const systemSalesNodes: COANode[] = [ 
       { id: 'inc_pos', code: '4101', name: 'POS / Counter Sales', type: 'Income', balance: posRevenue, icon: Store, isSystem: true, sourceModule: 'Sales', reportType: 'transaction', isActive: true }, 
       { id: 'inc_supply', code: '4102', name: 'Daily Supply Sales', type: 'Income', balance: supplyRevenue, icon: Truck, isSystem: true, sourceModule: 'Sales', reportType: 'transaction', isActive: true }, 
    ];

    const manualSalesNodes = buildManualNodes(manualAccounts, 'Income', 'inc_sales_group');
    const allSalesChildren = [...systemSalesNodes, ...manualSalesNodes];
    const totalSalesRevenue = allSalesChildren.reduce((sum, n) => sum + n.balance, 0);
    
    const salesRevenueGroup: COANode = {
        id: 'inc_sales_group',
        code: '4100',
        name: 'Sales Revenue',
        type: 'Income',
        balance: totalSalesRevenue,
        isGroup: true,
        isSystem: true,
        isActive: true,
        icon: TrendingUp,
        children: allSalesChildren
    };

    const otherManualIncome = buildManualNodes(manualAccounts, 'Income', undefined);
    const totalIncome = salesRevenueGroup.balance + otherManualIncome.reduce((sum, n) => sum + n.balance, 0);

    // Expenses
    const validExpenses = expenses.filter(e => (e as any).status !== 'Cancelled' && (e as any).status !== 'Returned');
    const expenseGroups = validExpenses.reduce((acc, exp) => { acc[exp.category] = (acc[exp.category] || 0) + Number(exp.amount || 0); return acc; }, {} as Record<string, number>);
    const opExpenseNodes: COANode[] = Object.entries(expenseGroups).map(([cat, amount]: [string, number], idx) => ({ id: `exp_${cat}`, code: `510${idx + 1}`, name: `${cat} Expense`, type: 'Expense', balance: amount, icon: FileText, isSystem: true, sourceModule: 'Expenses', reportType: 'transaction', isActive: true }));
    const milkPurchaseCost = purchases.filter(p => (p as any).status !== 'Returned' && (p as any).status !== 'Cancelled').reduce((sum, p) => sum + Number(p.total_amount || 0), 0);
    const materialPurchaseCost = materialPurchases.filter(p => (p as any).status !== 'Returned' && (p as any).status !== 'Cancelled').reduce((sum, p) => sum + Number(p.total_amount || 0), 0);
    const purchaseNodes: COANode[] = [ { id: 'cogs_milk', code: '5201', name: 'Cost of Goods - Milk', type: 'Expense', balance: milkPurchaseCost, icon: TrendingDown, isSystem: true, sourceModule: 'Purchases', reportType: 'transaction', isActive: true }, { id: 'cogs_mat', code: '5202', name: 'Cost of Goods - Materials', type: 'Expense', balance: materialPurchaseCost, icon: TrendingDown, isSystem: true, sourceModule: 'Purchases', reportType: 'transaction', isActive: true } ];
    const manualExpenses = buildManualNodes(manualAccounts, 'Expense', undefined);
    const allExpenseNodes = [...opExpenseNodes, ...purchaseNodes, ...manualExpenses];
    const totalExpenses = allExpenseNodes.reduce((sum, n) => sum + n.balance, 0);

    // Equity
    const capitalInjection = bankTransactions.filter(t => t.category === 'Capital Injection' || t.category === "Owner's Equity (Capital)").reduce((sum, t) => sum + t.amount, 0);
    const sysCapitalNode: COANode = { id: 'eq_cap_sys', code: '3100-SYS', name: "Unallocated Capital (System)", type: 'Equity', balance: capitalInjection, icon: DollarSign, isSystem: true, sourceModule: 'Bank & Cash', reportType: 'transaction', isActive: true };
    const manualCapitalNodes = buildManualNodes(manualAccounts, 'Equity', 'sys_eq_cap_group');
    const totalCapital = capitalInjection + manualCapitalNodes.reduce((sum, n) => sum + n.balance, 0);

    const drawings = bankTransactions.filter(t => t.category === 'Owner Drawings' || t.category === "Owner's Equity (Drawings)").reduce((sum, t) => sum + t.amount, 0);
    const sysDrawingsNode: COANode = { id: 'eq_draw_sys', code: '3200-SYS', name: "Unallocated Drawings (System)", type: 'Equity', balance: -drawings, icon: DollarSign, isSystem: true, sourceModule: 'Bank & Cash', reportType: 'transaction', isActive: true };
    const manualDrawingNodes = buildManualNodes(manualAccounts, 'Equity', 'sys_eq_draw_group');
    const totalDrawings = -drawings + manualDrawingNodes.reduce((sum, n) => sum + n.balance, 0);

    const capitalGroupNode: COANode = { id: 'sys_eq_cap_group', code: '3100', name: "Owners' Capital Accounts", type: 'Equity', balance: totalCapital, isGroup: true, isSystem: true, isActive: true, children: [sysCapitalNode, ...manualCapitalNodes] };
    const drawingsGroupNode: COANode = { id: 'sys_eq_draw_group', code: '3200', name: "Owners' Drawings Accounts", type: 'Equity', balance: totalDrawings, isGroup: true, isSystem: true, isActive: true, children: [sysDrawingsNode, ...manualDrawingNodes] };
    const otherManualEquity = buildManualNodes(manualAccounts, 'Equity', undefined).filter(n => !['sys_eq_cap_group', 'sys_eq_draw_group'].includes(n.id));
    const totalEquity = totalCapital + totalDrawings + otherManualEquity.reduce((sum, n) => sum + n.balance, 0);

    return [
      { id: '1000', code: '1000', name: 'ASSETS', type: 'Asset' as AccountType, isGroup: true, isSystem: true, balance: totalAssets, isActive: true, children: [ { id: '1100', code: '1100', name: 'Cash & Bank', type: 'Asset' as AccountType, isGroup: true, isSystem: true, balance: allCashBankNodes.reduce((s,n)=>s+n.balance,0), isActive: true, children: allCashBankNodes }, { id: '1001', code: '', name: 'Current Assets', type: 'Asset' as AccountType, isGroup: true, isSystem: true, balance: arNode.balance + invNode.balance + suppAdvNode.balance, isActive: true, children: [arNode, invNode, suppAdvNode] }, { id: '1400', code: '1400', name: 'Fixed Assets & Others', type: 'Asset' as AccountType, isGroup: true, isSystem: true, balance: manualAssets.reduce((s,n)=>s+n.balance,0), isActive: true, children: manualAssets }, ] },
      { id: '2000', code: '2000', name: 'LIABILITIES', type: 'Liability' as AccountType, isGroup: true, isSystem: true, balance: totalLiabilities, isActive: true, children: [ { id: '2001', code: '', name: 'Current Liabilities', type: 'Liability' as AccountType, isGroup: true, isSystem: true, balance: apNode.balance + advanceNode.balance, isActive: true, children: [apNode, advanceNode] }, { id: '2400', code: '2400', name: 'Long Term & Other', type: 'Liability' as AccountType, isGroup: true, isSystem: true, balance: manualLiabilities.reduce((s,n)=>s+n.balance,0), isActive: true, children: manualLiabilities }, ] },
      { id: '3000', code: '3000', name: 'EQUITY', type: 'Equity' as AccountType, isGroup: true, isSystem: true, balance: totalEquity, isActive: true, children: [capitalGroupNode, drawingsGroupNode, ...otherManualEquity] },
      { id: '4000', code: '4000', name: 'INCOME', type: 'Income' as AccountType, isGroup: true, isSystem: true, balance: totalIncome, isActive: true, children: [salesRevenueGroup, ...otherManualIncome] },
      { id: '5000', code: '5000', name: 'EXPENSES', type: 'Expense' as AccountType, isGroup: true, isSystem: true, balance: totalExpenses, isActive: true, children: allExpenseNodes },
    ];
  }, [accounts, inventory, customers, suppliers, purchases, materialPurchases, sales, dailySupplyEntries, expenses, expenseVendors, items, bankTransactions, manualAccounts]);

  // Search Filtering Logic
  const filteredCOA = useMemo(() => {
    if (!coaSearch) return chartOfAccounts;
    const lowerSearch = coaSearch.toLowerCase();
    
    const filterNode = (node: COANode): COANode | null => {
      const matches = node.name.toLowerCase().includes(lowerSearch) || (node.code && node.code.includes(lowerSearch));
      let filteredChildren: COANode[] = [];
      if (node.children) {
        filteredChildren = node.children.map(filterNode).filter(Boolean) as COANode[];
      }
      if (matches || filteredChildren.length > 0) {
        return { ...node, children: filteredChildren };
      }
      return null;
    };

    return chartOfAccounts.map(filterNode).filter(Boolean) as COANode[];
  }, [chartOfAccounts, coaSearch]);

  useEffect(() => {
    if (coaSearch) {
      const newExpanded: Record<string, boolean> = {};
      const traverse = (nodes: COANode[]) => {
        nodes.forEach(node => {
          newExpanded[node.id] = true;
          if (node.children) traverse(node.children);
        });
      };
      traverse(filteredCOA);
      setExpandedGroups(prev => ({ ...prev, ...newExpanded }));
    }
  }, [coaSearch, filteredCOA]);

  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAccount.name?.trim() || isSubmitting) return;
    
    const isCashOrBank = newAccount.parentId === '1100' || (!newAccount.parentId && newAccount.type === 'Asset' && (
      newAccount.name.toLowerCase().includes('bank') ||
      newAccount.name.toLowerCase().includes('cash') ||
      newAccount.name.toLowerCase().includes('jazz') ||
      newAccount.name.toLowerCase().includes('easypaisa') ||
      newAccount.name.toLowerCase().includes('wallet')
    ));

    setIsSubmitting(true);
    try {
      if (isCashOrBank) {
        const ok = await addAccount({
          name: newAccount.name.trim(),
          type: newAccount.name.toLowerCase().includes('cash') ? 'Cash' : 'Bank',
          balance: newAccount.balance || 0,
          isActive: true
        });
        if (!ok) return;
        showToast(`Bank / Cash account "${newAccount.name}" ban gaya`, "success");
      } else {
        const ok = await addManualAccount(newAccount as any);
        if (!ok) return;
        showToast("Naya ledger account ban gaya", "success");
      }

      setIsAddOpen(false);
      setNewAccount({ name: '', type: 'Liability', balance: 0, description: '', parentId: '', isActive: true });
    } catch (err: any) {
      showToast("Account nahi ban saka: " + (err?.message || "dobara koshish karein"), "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenAddSub = (parent: COANode) => {
    setNewAccount({ name: '', type: parent.type, balance: 0, description: '', parentId: parent.id, isActive: true });
    setIsAddOpen(true);
  };

  const handleDelete = async (node: COANode) => {
    if (node.isSystem) { showToast(`System account delete nahi ho sakta.`, 'warning'); return; }
    if (node.children && node.children.length > 0) { showToast("Is account ke neeche sub-accounts hain, pehle unhein hatayen.", 'error'); return; }

    if (Math.abs(node.balance) > 0) {
        showToast("Account mein balance baqi hai. Delete ke bajaye Inactive karein.", 'warning');
        return;
    }

    const ok = await confirmAction({
      title: `"${node.name}" delete karein?`,
      message: 'Yeh account chart of accounts se hamesha ke liye hat jayega.',
      consequences: ['Is ka balance zero hai, is liye kisi ledger par asar nahi hoga.', 'Yeh kaam wapas nahi ho sakta.'],
    });
    if (ok) {
        deleteManualAccount(node.id);
        showToast("Account delete ho gaya", "success");
    }
  };

  const toggleActiveStatus = (node: COANode) => {
     if (node.isSystem) return;
     const newStatus = !node.isActive;
     updateManualAccount(node.id, { isActive: newStatus });
     showToast(`Account ${newStatus ? "Active" : "Inactive"} kar diya gaya`, "info");
  };

  // --- JOURNAL ENTRY LOGIC ---
  const selectableAccounts: SelectableAccount[] = useMemo(() => {
    const list: SelectableAccount[] = [];
    manualAccounts.filter(a => a.isActive !== false).forEach(a => list.push({ id: a.id, name: a.name, type: 'Manual', category: a.type }));
    accounts.filter(a => a.isActive).forEach(a => list.push({ id: a.id, name: a.name, type: 'Bank', category: 'Asset', balance: a.balance }));
    // Customer / supplier khata is not offered: a journal line cannot post to those ledgers, and it
    // used to be dropped silently. Use Receive Payment / Pay Supplier (or a khata charge) instead.
    return list;
  }, [manualAccounts, accounts]);

  const totalDebit = journalLines.reduce((sum, l) => sum + (l.debit || 0), 0);
  const totalCredit = journalLines.reduce((sum, l) => sum + (l.credit || 0), 0);
  const isBalanced = totalDebit > 0 && Math.abs(totalDebit - totalCredit) < 0.01;

  const handleLineChange = (id: string, field: keyof JournalLine, value: any) => {
    setJournalLines(prev => prev.map(line => {
      if (line.id === id) {
        if (field === 'accountId') {
          const acc = selectableAccounts.find(a => a.id === value);
          return { ...line, accountId: value, accountName: acc?.name || '', accountType: acc?.type || '' };
        }
        return { ...line, [field]: value };
      }
      return line;
    }));
  };

  const addLine = () => {
    setJournalLines([...journalLines, { id: Math.random().toString(), accountId: '', accountName: '', accountType: '', debit: 0, credit: 0 }]);
  };

  const removeLine = (id: string) => {
    if (journalLines.length <= 2) return;
    setJournalLines(journalLines.filter(l => l.id !== id));
  };

  const handlePostJournal = async () => {
    if (!isBalanced) { showToast("Journal entry balance nahi: Debit aur Credit barabar hone chahiyen", "error"); return; }
    if (journalLines.some(l => !l.accountId)) { showToast("Har line mein account chunein", "error"); return; }
    if (isSubmittingJournal) return;

    setIsSubmittingJournal(true);
    try {
      await addJournalEntry({
        date: journalDate,
        referenceNo: journalRef,
        narration: journalNarration,
        lines: journalLines,
        totalAmount: totalDebit
      });

      showToast("Journal entry post ho gayi", "success");
      setJournalRef('');
      setJournalNarration('');
      setJournalLines([
        { id: '1', accountId: '', accountName: '', accountType: '', debit: 0, credit: 0 },
        { id: '2', accountId: '', accountName: '', accountType: '', debit: 0, credit: 0 }
      ]);
    } catch (err: any) {
      showToast("Journal entry post nahi hui: " + (err?.message || "dobara koshish karein"), "error");
    } finally {
      setIsSubmittingJournal(false);
    }
  };

  const parentOptions = useMemo(() => {
     const options: {id: string, name: string, type: string}[] = [];
     const traverse = (nodes: COANode[], depth: number) => {
        nodes.forEach(node => {
           const allowParenting = node.isGroup || (!node.isSystem) || ['inc_sales_group', 'sys_eq_cap_group', 'sys_eq_draw_group'].includes(node.id);
           if (allowParenting) {
              options.push({ id: node.id, name: `${'- '.repeat(depth)}${node.name}`, type: node.type });
           }
           if (node.children) traverse(node.children, depth + 1);
        });
     };
     traverse(chartOfAccounts, 0);
     return options;
  }, [chartOfAccounts]);

  const inputClass = "w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs font-semibold text-slate-800 outline-none focus:bg-white focus:border-lime-500 focus:ring-2 focus:ring-lime-500/10 transition-all shadow-inner";
  const labelClass = "block text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-1 ml-0.5";

  // --- Recursive Accounting Node Component ---
  const AccountingRow: React.FC<{ node: COANode, level: number }> = ({ node, level }) => {
    const isExpanded = expandedGroups[node.id];
    const hasChildren = node.children && node.children.length > 0;
    const isHeader = level === 0;
    const isInactive = node.isActive === false;
    
    let amountColor = isInactive ? 'text-slate-400' : 'text-slate-900';
    if (!isInactive) {
        if (node.type === 'Asset' || node.type === 'Income') amountColor = 'text-emerald-700';
        if (node.type === 'Liability' || node.type === 'Expense') amountColor = 'text-rose-700';
        if (node.type === 'Equity') amountColor = 'text-blue-700';
        if (node.name.includes("Drawings")) amountColor = 'text-rose-600';
    }
    
    const Icon = node.icon || FileText;

    return (
      <div className="flex flex-col">
        {/* Node Row */}
        <div 
          className={`flex items-center justify-between gap-2 px-3 sm:px-4 py-2.5 border-b border-slate-100/90 dark:border-slate-800 transition-all ${
            isHeader 
               ? 'bg-slate-100/90 dark:bg-slate-800/90 text-slate-900 dark:text-white font-bold py-3 rounded-xl sm:rounded-none my-1 sm:my-0 border-y border-slate-200/80 dark:border-slate-700' 
               : level === 1 
                  ? 'bg-slate-50/70 dark:bg-slate-900/50 font-bold hover:bg-slate-100/60 dark:hover:bg-slate-800/40' 
                  : 'hover:bg-lime-50/30 dark:hover:bg-lime-950/20'
          } ${isInactive ? 'opacity-50 bg-slate-50 dark:bg-slate-900' : ''}`} 
          style={{ paddingLeft: `${Math.max(12, level * 16 + 12)}px` }}
        >
          {/* Left: Caret + Code + Name & Badges */}
          <div className="flex items-center gap-1.5 sm:gap-2.5 min-w-0 flex-1">
            {hasChildren ? (
              <button aria-label="Khol / band karein" 
                onClick={() => toggleGroup(node.id)} 
                className={`p-1 rounded-lg transition-colors shrink-0 cursor-pointer ${
                  isHeader ? 'hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300' : 'hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-400'
                }`}
              >
                {isExpanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
              </button>
            ) : (
              <span className="w-6 shrink-0" />
            )}

            {node.code && (
              <span className={`font-mono text-[9px] sm:text-[10px] px-1.5 py-0.2 rounded font-bold shrink-0 ${
                isHeader ? 'bg-lime-100 dark:bg-lime-950/50 text-lime-800 dark:text-lime-300 border border-lime-200/80 dark:border-lime-800/40' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700'
              }`}>
                {node.code}
              </span>
            )}

            <div className="flex items-center gap-1.5 min-w-0 flex-1 truncate">
              {!isHeader && !node.isGroup && (
                <Icon size={13} className={`shrink-0 ${!node.isSystem ? 'text-blue-500' : 'text-slate-400'}`} />
              )}
              <span className={`truncate ${
                isHeader 
                  ? 'text-xs sm:text-sm font-bold uppercase tracking-wider text-slate-900 dark:text-white' 
                  : level === 1 
                    ? 'text-xs font-bold text-slate-900 dark:text-slate-100' 
                    : 'text-xs font-semibold text-slate-700 dark:text-slate-300'
              }`}>
                {node.name}
              </span>

              {!node.isSystem && !node.isGroup && (
                <span className="text-[8px] sm:text-[9px] bg-blue-50 text-blue-600 px-1.5 py-0.2 rounded font-bold border border-blue-100 shrink-0">
                  Manual
                </span>
              )}

              {isInactive && (
                <span className="text-[8px] bg-slate-200 text-slate-600 px-1 py-0.2 rounded font-bold shrink-0">
                  Inactive
                </span>
              )}
            </div>
          </div>

          {/* Right: Balance + Actions */}
          <div className="flex items-center gap-2 sm:gap-4 shrink-0">
            <div className={`text-right font-mono font-black ${isHeader ? 'text-xs sm:text-sm text-lime-400' : 'text-xs'} ${amountColor}`}>
              {node.balance < 0 ? `(${formatMoneyRaw(Math.abs(node.balance))})` : `${formatCurrency(node.balance)}`}
            </div>

            {!isHeader && (
              <div className="flex items-center gap-0.5">
                {/* Add sub-account */}
                {(node.isGroup || !node.isSystem || ['inc_sales_group'].includes(node.id)) && (
                   <button aria-label="Add Sub-account" 
                     onClick={() => handleOpenAddSub(node)} 
                     className="text-slate-400 hover:text-emerald-600 p-1 hover:bg-emerald-50 rounded-lg transition-colors cursor-pointer" 
                     title="Add Sub-account"
                   >
                      <PlusCircle size={13} />
                   </button>
                )}

                {!node.isSystem && (
                    <button aria-label={node.isActive !== false ? "Deactivate" : "Activate"} 
                      onClick={() => toggleActiveStatus(node)} 
                      className={`p-1 rounded-lg transition-colors cursor-pointer ${node.isActive !== false ? 'text-slate-400 hover:text-amber-600 hover:bg-amber-50' : 'text-amber-600 bg-amber-50'}`} 
                      title={node.isActive !== false ? "Deactivate" : "Activate"}
                    >
                        <Power size={13} />
                    </button>
                )}

                {node.isSystem ? (
                   <div title="System Control Account" className="p-1 text-slate-300">
                      <Lock size={12} />
                   </div>
                ) : (
                   <button aria-label="Delete Account" 
                     onClick={() => handleDelete(node)} 
                     className="text-slate-400 hover:text-rose-600 p-1 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer" 
                     title="Delete Account"
                   >
                      <Trash2 size={13} />
                   </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Children Rows */}
        <AnimatePresence>
          {hasChildren && isExpanded && (
            <MotionDiv 
              initial={{ opacity: 0, height: 0 }} 
              animate={{ opacity: 1, height: 'auto' }} 
              exit={{ opacity: 0, height: 0 }}
            >
              {node.children!.map(child => (
                <AccountingRow key={child.id} node={child} level={level + 1} />
              ))}
            </MotionDiv>
          )}
        </AnimatePresence>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-[calc(100vh-5.5rem)] md:h-[calc(100vh-6.5rem)] gap-2.5 sm:gap-3.5 pb-2 overflow-hidden">
      
      {/* Header & Tab Selector Strip (Mobile Responsive) */}
      <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-2 bg-white p-2.5 sm:p-3 rounded-2xl border border-slate-200/90 shadow-2xs shrink-0">
        <div className="flex items-center gap-2">
           <div className="p-2 bg-lime-500/10 text-lime-800 rounded-xl border border-lime-500/20 shrink-0">
              <Landmark size={18} className="text-lime-700" />
           </div>
           <div>
              <h2 className="text-sm sm:text-base font-black text-slate-900 tracking-tight leading-tight">Accounts & General Ledger</h2>
              <p className="text-[10px] sm:text-xs font-semibold text-slate-500">Financial chart of accounts & double entry journals</p>
           </div>
        </div>

        {/* Tab Toggle Switch */}
        <div className="flex p-1 bg-slate-100 rounded-xl shrink-0">
           <button 
             onClick={() => selectTab('chart')} 
             className={`flex-1 sm:flex-initial px-3 py-1.5 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                activeTab === 'chart' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
             }`}
           >
              <PieChart size={14}/> <span>Chart of Accounts</span>
           </button>
           <button 
             onClick={() => selectTab('journal')} 
             className={`flex-1 sm:flex-initial px-3 py-1.5 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                activeTab === 'journal' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
             }`}
           >
              <BookOpen size={14}/> <span>Journal Entry</span>
           </button>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* --- TAB 1: CHART OF ACCOUNTS (COA) ---                                   */}
      {/* ========================================================================= */}
      {activeTab === 'chart' && (
         <div className="flex-1 overflow-hidden flex flex-col gap-2.5 min-h-0">
            {/* Toolbar Row */}
            <div className="flex items-center gap-2 bg-white p-2.5 sm:p-3 rounded-2xl border border-slate-200/90 shadow-2xs shrink-0">
               <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                  <input 
                    type="text" 
                    placeholder="Search accounts by code or name..." 
                    className="w-full pl-8.5 pr-7 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:border-lime-500 transition-all shadow-inner"
                    value={coaSearch} 
                    onChange={e => setCoaSearch(e.target.value)}
                  />
                  {coaSearch && (
                     <button aria-label="Hatayen" onClick={() => setCoaSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5 cursor-pointer">
                        <X size={12} />
                     </button>
                  )}
               </div>

               <button 
                 onClick={() => { 
                   setNewAccount({ name: '', type: 'Liability', balance: 0, description: '', parentId: '', isActive: true }); 
                   setIsAddOpen(true); 
                 }} 
                 className="bg-lime-600 hover:bg-lime-700 text-white px-3.5 py-2 rounded-xl font-bold text-xs shadow-xs flex items-center gap-1.5 transition-all active:scale-95 shrink-0 cursor-pointer"
               >
                  <Plus size={14} /> <span>New Account</span>
               </button>
            </div>
            
            {/* COA Tree Container */}
            <div className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs overflow-hidden flex-1 flex flex-col min-h-0">
               <div className="flex items-center justify-between px-4 py-2.5 bg-slate-50 border-b border-slate-200 text-[10px] font-bold text-slate-500 uppercase tracking-wider shrink-0">
                  <div className="flex-1">Account Hierarchy / Name</div>
                  <div className="text-right">Balance (PKR)</div>
               </div>
               <div className="flex-1 overflow-y-auto divide-y divide-slate-50 p-1 sm:p-0">
                  {filteredCOA.length > 0 ? (
                     filteredCOA.map(node => (<AccountingRow key={node.id} node={node} level={0} />))
                  ) : (
                     <div className="py-12 text-center text-slate-400">
                        <Landmark size={28} className="mx-auto text-slate-300 mb-1.5" />
                        <p className="font-semibold text-xs text-slate-600">No accounts match your search.</p>
                     </div>
                  )}
               </div>
            </div>
         </div>
      )}

      {/* ========================================================================= */}
      {/* --- TAB 2: GENERAL ENTRY (JOURNAL) ---                                    */}
      {/* ========================================================================= */}
      {activeTab === 'journal' && (
         <div className="flex-1 flex flex-col lg:flex-row gap-3 overflow-hidden min-h-0">
            {/* Left: Journal Entry Form */}
            <div className="flex-[2] bg-white rounded-2xl border border-slate-200/90 shadow-2xs overflow-hidden flex flex-col min-h-0">
               {/* Form Header Inputs */}
               <div className="p-3 sm:p-4 border-b border-slate-100 bg-slate-50/60 grid grid-cols-1 sm:grid-cols-2 gap-2.5 shrink-0">
                  <div>
                     <label className={labelClass}>Journal Date</label>
                     <input type="date" className={inputClass} value={journalDate} onChange={e => setJournalDate(e.target.value)} />
                  </div>
                  <div>
                     <label className={labelClass}>Reference #</label>
                     <input type="text" className={inputClass} placeholder="e.g. JV-001" value={journalRef} onChange={e => setJournalRef(e.target.value)} />
                  </div>
               </div>
               
               <div className="px-3 sm:px-4 py-2.5 border-b border-slate-100 bg-white shrink-0">
                  <label className={labelClass}>Narration / Description</label>
                  <input type="text" className={inputClass} placeholder="Transaction explanation / remarks..." value={journalNarration} onChange={e => setJournalNarration(e.target.value)} />
               </div>
               
               {/* Line Entries Container */}
               <div className="flex-1 overflow-y-auto p-2.5 sm:p-4 space-y-2">
                  <div className="space-y-2">
                     {journalLines.map((line, idx) => (
                        <div key={line.id} className="bg-slate-50 p-2.5 rounded-2xl border border-slate-200/90 space-y-2">
                           <div className="flex items-center justify-between gap-2">
                              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Line #{idx + 1}</span>
                              {journalLines.length > 2 && (
                                 <button aria-label="Delete karein" onClick={() => removeLine(line.id)} className="text-slate-400 hover:text-rose-600 p-1 cursor-pointer">
                                    <Trash2 size={13}/>
                                 </button>
                              )}
                           </div>
                           
                           {/* Account Selector */}
                           <div>
                              <select 
                                className={inputClass} 
                                value={line.accountId} 
                                onChange={e => handleLineChange(line.id, 'accountId', e.target.value)}
                              >
                                 <option value="">Select Account...</option>
                                 {selectableAccounts.map(acc => (
                                    <option key={acc.id} value={acc.id}>{acc.name} ({acc.category})</option>
                                 ))}
                              </select>
                           </div>

                           {/* Debit & Credit Inputs */}
                           <div className="grid grid-cols-2 gap-2">
                              <div>
                                 <label className="text-[10px] font-bold text-slate-500 uppercase block mb-0.5 ml-0.5">Debit (Rs)</label>
                                 <input 
                                   type="number" min="0" 
                                   className={`${inputClass} font-mono font-bold text-slate-900`} 
                                   placeholder="0.00" 
                                   value={line.debit || ''} 
                                   onChange={e => { 
                                     handleLineChange(line.id, 'debit', parseFloat(e.target.value) || 0); 
                                     handleLineChange(line.id, 'credit', 0); 
                                   }} 
                                 />
                              </div>
                              <div>
                                 <label className="text-[10px] font-bold text-slate-500 uppercase block mb-0.5 ml-0.5">Credit (Rs)</label>
                                 <input 
                                   type="number" min="0" 
                                   className={`${inputClass} font-mono font-bold text-slate-900`} 
                                   placeholder="0.00" 
                                   value={line.credit || ''} 
                                   onChange={e => { 
                                     handleLineChange(line.id, 'credit', parseFloat(e.target.value) || 0); 
                                     handleLineChange(line.id, 'debit', 0); 
                                   }} 
                                 />
                              </div>
                           </div>
                        </div>
                     ))}
                  </div>

                  <button 
                    onClick={addLine} 
                    className="w-full py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl flex items-center justify-center gap-1 transition-all cursor-pointer"
                  >
                     <Plus size={14}/> <span>Add Entry Line</span>
                  </button>
               </div>

               {/* Post Summary Footer */}
               <div className="p-3 sm:p-4 border-t border-slate-200 bg-slate-50/80 shrink-0 space-y-2.5">
                  <div className="grid grid-cols-3 gap-2 text-center bg-white p-2 rounded-xl border border-slate-200">
                     <div>
                        <p className="text-[10px] font-bold text-slate-500 uppercase">Debit</p>
                        <p className="text-xs sm:text-sm font-black font-mono text-slate-900">{formatCurrency(totalDebit)}</p>
                     </div>
                     <div>
                        <p className="text-[10px] font-bold text-slate-500 uppercase">Credit</p>
                        <p className="text-xs sm:text-sm font-black font-mono text-slate-900">{formatCurrency(totalCredit)}</p>
                     </div>
                     <div>
                        <p className="text-[10px] font-bold text-slate-500 uppercase">Difference</p>
                        <p className={`text-xs sm:text-sm font-black font-mono ${isBalanced ? 'text-emerald-600' : 'text-rose-600'}`}>
                           {formatCurrency(Math.abs(totalDebit - totalCredit))}
                        </p>
                     </div>
                  </div>

                  <button 
                     onClick={handlePostJournal}
                     disabled={!isBalanced || totalDebit === 0 || isSubmittingJournal}
                     className={`w-full py-2.5 rounded-xl font-bold text-xs sm:text-sm text-white shadow-md transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                        isBalanced && totalDebit > 0 && !isSubmittingJournal ? 'bg-lime-600 hover:bg-lime-700' : 'bg-slate-300 cursor-not-allowed shadow-none'
                     }`}
                  >
                     {isSubmittingJournal ? (
                        <>
                           <Loader2 size={16} className="animate-spin" /> Posting Journal...
                        </>
                     ) : (
                        <>
                           <CheckCircle size={16} /> Post Journal Entry
                        </>
                     )}
                  </button>
               </div>
            </div>

            {/* Right: Recent Journal History Feed */}
            <div className="flex-1 bg-white rounded-2xl border border-slate-200/90 shadow-2xs overflow-hidden flex flex-col min-h-0">
               <div className="px-4 py-3 border-b border-slate-100 bg-slate-50 flex items-center justify-between shrink-0">
                  <h3 className="font-bold text-xs sm:text-sm text-slate-800 flex items-center gap-1.5">
                     <HistoryIcon size={15}/> <span>Recent Journal Vouchers</span>
                  </h3>
                  <span className="text-[10px] font-bold text-slate-500 bg-slate-200 px-2 py-0.5 rounded-full">
                     {journalEntries.length} entries
                  </span>
               </div>
               
               <div className="flex-1 overflow-y-auto p-2.5 space-y-2">
                  {journalEntries.length === 0 ? (
                     <div className="text-center text-slate-400 py-12">
                        <BookOpen size={28} className="mx-auto mb-1.5 opacity-50"/>
                        <p className="text-xs font-semibold">No journal entries recorded.</p>
                     </div>
                  ) : (
                     journalEntries.map(entry => (
                        <div key={entry.id} className="bg-white border border-slate-200/90 rounded-2xl p-3 shadow-2xs space-y-1.5">
                           <div className="flex justify-between items-start gap-2">
                              <div className="flex items-center gap-1.5">
                                 <span className="text-[10px] font-mono font-bold bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded border border-slate-200">{entry.referenceNo || 'JV'}</span>
                                 <span className="text-[10px] text-slate-500">{new Date(entry.date).toLocaleDateString()}</span>
                              </div>
                              <span className="font-mono font-black text-slate-900 text-xs">{formatCurrency(entry.totalAmount)}</span>
                           </div>
                           {entry.narration && (
                              <p className="text-xs text-slate-700 font-medium italic">"{entry.narration}"</p>
                           )}
                           <div className="space-y-1 pt-1 border-t border-slate-100 text-[11px]">
                              {entry.lines.map((line, idx) => (
                                 <div key={idx} className="flex justify-between text-slate-600">
                                    <span className="truncate pr-2 font-medium">{line.accountName}</span>
                                    <div className="flex gap-3 font-mono font-bold shrink-0">
                                       <span className={line.debit > 0 ? 'text-emerald-700' : 'text-slate-300'}>{line.debit > 0 ? `Dr ${formatMoneyRaw(line.debit)}` : '-'}</span>
                                       <span className={line.credit > 0 ? 'text-rose-700' : 'text-slate-300'}>{line.credit > 0 ? `Cr ${formatMoneyRaw(line.credit)}` : '-'}</span>
                                    </div>
                                 </div>
                              ))}
                           </div>
                        </div>
                     ))
                  )}
               </div>
            </div>
         </div>
      )}

      {/* ========================================================================= */}
      {/* --- ADD ACCOUNT MODAL (z-[100]) ---                                      */}
      {/* ========================================================================= */}
      <AnimatePresence>
         {isAddOpen && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-4">
               <MotionDiv 
                 initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} 
                 className="absolute inset-0 bg-slate-950/60 backdrop-blur-xs" 
                 onClick={() => setIsAddOpen(false)} 
               />
               <MotionDiv 
                 initial={{ scale: 0.95, opacity: 0, y: 15 }} 
                 animate={{ scale: 1, opacity: 1, y: 0 }} 
                 exit={{ scale: 0.95, opacity: 0, y: 15 }} 
                 className="relative bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden max-h-[92vh] flex flex-col"
               >
                  <div className="px-5 py-4 border-b border-slate-100 bg-slate-50 flex justify-between items-center shrink-0">
                     <h3 className="font-bold text-sm sm:text-base text-slate-900 flex items-center gap-2">
                        <Plus size={16} className="text-lime-600"/> 
                        <span>{newAccount.parentId ? 'Add Sub-Account' : 'Add Ledger Account'}</span>
                     </h3>
                     <button aria-label="Band karein" onClick={() => setIsAddOpen(false)} className="bg-white p-1.5 rounded-full hover:bg-slate-100 text-slate-500 hover:text-slate-800 transition-colors cursor-pointer"><X size={15}/></button>
                  </div>

                  <form onSubmit={handleAddSubmit} className="p-4 sm:p-5 space-y-3.5 overflow-y-auto flex-1">
                     {/* Parent Account Selection */}
                     <div>
                        <label className={labelClass}>Parent Account (Optional)</label>
                        <select 
                           className={inputClass} 
                           value={newAccount.parentId || ''}
                           onChange={e => {
                              const pid = e.target.value;
                              const parentType = parentOptions.find(p => p.id === pid)?.type as AccountType;
                              setNewAccount({...newAccount, parentId: pid, type: parentType || newAccount.type});
                           }}
                        >
                           <option value="">(None) Top Level Account</option>
                           {parentOptions.map(opt => (
                              <option key={opt.id} value={opt.id}>{opt.name}</option>
                           ))}
                        </select>
                     </div>

                     <div>
                        <label className={labelClass}>Account Name</label>
                        <input type="text" className={inputClass} placeholder="e.g. Owner Capital, Electricity Bill" required value={newAccount.name} onChange={e => setNewAccount({...newAccount, name: e.target.value})} autoFocus />
                     </div>
                     
                     {/* Account Type */}
                     <div>
                        <label className={labelClass}>Account Type</label>
                        <select 
                           className={`${inputClass} ${newAccount.parentId ? 'bg-slate-100 text-slate-500' : ''}`}
                           value={newAccount.type} 
                           onChange={e => setNewAccount({...newAccount, type: e.target.value as any})}
                           disabled={!!newAccount.parentId}
                        >
                           <option value="Asset">Asset</option>
                           <option value="Liability">Liability</option>
                           <option value="Equity">Equity</option>
                           <option value="Income">Income</option>
                           <option value="Expense">Expense</option>
                        </select>
                     </div>
                     
                     <div>
                        <label className={labelClass}>Opening Balance (Rs)</label>
                        <input type="number" className={inputClass} placeholder="0.00" value={newAccount.balance || ''} onChange={e => setNewAccount({...newAccount, balance: parseFloat(e.target.value) || 0})} />
                     </div>
                     
                     <div>
                        <label className={labelClass}>Description / Remarks</label>
                        <input type="text" className={inputClass} placeholder="Optional notes..." value={newAccount.description} onChange={e => setNewAccount({...newAccount, description: e.target.value})} />
                     </div>

                     <button 
                        type="submit" 
                        disabled={isSubmitting}
                        className={`w-full py-3 text-white font-bold rounded-xl shadow-md mt-2 text-xs sm:text-sm transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                          isSubmitting ? 'bg-slate-400 text-white cursor-not-allowed shadow-none' : 'bg-lime-600 hover:bg-lime-700'
                        }`}
                      >
                         {isSubmitting ? (
                            <>
                               <Loader2 size={16} className="animate-spin" /> Saving...
                            </>
                         ) : (
                            'Create Account'
                         )}
                      </button>
                  </form>
               </MotionDiv>
            </div>
         )}
      </AnimatePresence>

    </div>
  );
};

export default Accounts;
