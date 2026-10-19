import React, { useState, useMemo, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useDairy } from '../context/DairyContext';
import { useToast } from '../context/ToastContext';
import { FinancialAccount, BankTransaction } from '../types';
import {
  Landmark, Wallet, ArrowUpRight, ArrowDownLeft,
  ArrowRightLeft, Plus, History, X, Briefcase,
  ArrowUp, ArrowDown, Edit3, Trash2, Lock, Search, Filter,
  ArrowLeft, CheckCircle2, AlertCircle, Clock, Clock3, CreditCard,
  ChevronRight, ChevronLeft, Sparkles, Building2, Smartphone, Loader2, Archive, RotateCcw
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { formatCurrency } from '../lib/formatters';
import { confirmAction } from '../components/ui/ConfirmDialog';

// --- Framer Motion Fix ---
const MotionDiv = motion.div as any;

interface UnifiedAccountEntry {
  id: string;
  date: string;
  type: 'Deposit' | 'Withdrawal' | 'Income' | 'Expense' | 'Transfer_In' | 'Transfer_Out';
  category: string;
  description: string;
  amount: number;
  accountId: string;
  accountName: string;
  sourceModule: 'Direct' | 'Expense' | 'POS Sale' | 'Customer Payment' | 'Supplier Payment' | 'Payroll';
  rawEntry?: any;
}

const BankCash: React.FC = () => {
  const {
    accounts, bankTransactions, expenses, sales,
    customers, customerTransactions,
    suppliers, supplierTransactions,
    settings, cashInTransit,
    addAccount, updateAccount, deleteAccount,
    recordBankTransaction, transferFunds,
    manualAccounts, updateManualAccount,
    getDeleteAssessment, safeDeleteAccount, reactivateEntity
  } = useDairy();
  const { showToast } = useToast();

  const location = useLocation();
  const navigate = useNavigate();

  // Selection & Mobile Navigation State
  const [selectedAccountId, setSelectedAccountId] = useState<string>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('account') || 'all';
  });
  const [isMobileLedgerOpen, setIsMobileLedgerOpen] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const acc = params.get('account');
    return Boolean(acc && acc !== 'all');
  });

  const selectAccount = (id: string) => {
    setSelectedAccountId(id);
    setIsMobileLedgerOpen(id !== 'all');
    if (id !== 'all') {
      navigate(`/bank-cash?account=${encodeURIComponent(id)}`);
    } else {
      navigate('/bank-cash');
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const acc = params.get('account') || 'all';
    setSelectedAccountId(acc);
    if (acc !== 'all') {
      setIsMobileLedgerOpen(true);
    }
  }, [location.search]);

  // Wallets List Filters
  const [walletSearch, setWalletSearch] = useState('');
  const [walletTypeFilter, setWalletTypeFilter] = useState<'All' | 'Cash' | 'Bank' | 'Wallet'>('All');

  // Ledger Table Filters & Pagination
  const [ledgerSearch, setLedgerSearch] = useState('');
  const [ledgerTypeFilter, setLedgerTypeFilter] = useState<'All' | 'Inflow' | 'Outflow' | 'Transfer'>('All');
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 50;

  // Modal States
  const [isTransferOpen, setIsTransferOpen] = useState(false);
  const [isTransactionOpen, setIsTransactionOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmittingTransfer, setIsSubmittingTransfer] = useState(false);
  const [isSubmittingAccount, setIsSubmittingAccount] = useState(false);
  const [transactionType, setTransactionType] = useState<'Deposit' | 'Withdrawal'>('Deposit');
  const [isAddAccountOpen, setIsAddAccountOpen] = useState(false);
  const [isEditAccountOpen, setIsEditAccountOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<FinancialAccount | null>(null);

  // Forms
  const [transferData, setTransferData] = useState({
    fromId: '', toId: '', amount: '', description: '', date: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' })
  });

  const [transactionData, setTransactionData] = useState({
    accountId: '', 
    amount: '', 
    description: '', 
    date: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' }), 
    relatedAccountId: '' // Selected Contra Account ID
  });

  const [accountData, setAccountData] = useState<Partial<FinancialAccount>>({
    name: '', type: 'Bank', balance: 0, isActive: true, bank_name: '', account_number: ''
  });

  const [editAccountFormData, setEditAccountFormData] = useState<Partial<FinancialAccount>>({
    name: '', type: 'Bank', bank_name: '', account_number: '', isActive: true
  });

  // --- Derived Data ---
  const selectedAccount = accounts.find(a => a.id === selectedAccountId);

  // Unified Universal Ledger Feed with Deduplication
  const unifiedEntries = useMemo<UnifiedAccountEntry[]>(() => {
    const list: UnifiedAccountEntry[] = [];
    const defaultCashId = settings.financial?.defaultCashAccountId || accounts.find(a => a.type === 'Cash')?.id || accounts[0]?.id || '';
    const defaultBankId = settings.financial?.defaultDigitalAccountId || accounts.find(a => a.type === 'Bank' || a.type === 'Wallet')?.id || accounts[0]?.id || '';

    // Fast-lookup sets for O(1) deduplication against direct bank_transactions
    const btxIds = new Set<string>();
    const btxRefIds = new Set<string>();
    const btxBillTokens = new Set<string>();

    bankTransactions.forEach(tx => {
      if (tx.id) btxIds.add(tx.id);
      if (tx.reference_id) btxRefIds.add(tx.reference_id);
      if (tx.description) {
        const match = tx.description.match(/#?([A-Z0-9]+-[0-9]+-[A-Z0-9]+)/i);
        if (match) btxBillTokens.add(match[1]);
      }
    });

    // 1. Direct Bank Transactions (Primary General Ledger)
    bankTransactions.forEach(tx => {
      const acc = accounts.find(a => a.id === tx.account_id);
      const catLower = (tx.category || '').toLowerCase();
      const descLower = (tx.description || '').toLowerCase();

      let sourceModule: UnifiedAccountEntry['sourceModule'] = 'Direct';
      if (catLower.includes('pos') || descLower.includes('pos cash sale') || descLower.includes('pos sale')) {
        sourceModule = 'POS Sale';
      } else if (catLower.includes('milk') || catLower.includes('supplier') || descLower.includes('milk intake') || descLower.includes('supplier payment')) {
        sourceModule = 'Supplier Payment';
      } else if (catLower.includes('customer') || descLower.includes('customer receipt') || descLower.includes('payment from:')) {
        sourceModule = 'Customer Payment';
      } else if (catLower.includes('expense') || descLower.includes('expense:')) {
        sourceModule = 'Expense';
      }

      list.push({
        id: tx.id,
        date: tx.date || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' }),
        type: tx.type as any,
        category: tx.category || tx.type,
        description: tx.description || tx.type,
        amount: tx.amount || 0,
        accountId: tx.account_id,
        accountName: acc?.name || 'Account',
        sourceModule,
        rawEntry: tx
      });
    });

    // 2. Expenses (Only un-synced / local offline expenses not in bankTransactions)
    expenses.forEach(exp => {
      if ((exp as any).status === 'Cancelled' || (exp as any).status === 'Returned') return;
      if (exp.paymentStatus === 'Unpaid' || (exp as any).payment_status === 'Unpaid') return;
      const actualPaid = exp.paymentStatus === 'Partial'
        ? Number(exp.paidAmount || 0)
        : Number(exp.paidAmount ?? (exp as any).paid_amount ?? exp.amount ?? 0);
      if (actualPaid <= 0) return;

      const isAlreadyInBankTx = btxIds.has(`btx_${exp.id}`) || 
        btxRefIds.has(exp.id) || 
        bankTransactions.some(bt => (bt as any).related_expense_id === exp.id || bt.description?.includes(exp.id));
      
      if (!isAlreadyInBankTx) {
        const accId = exp.account_id || (exp.paymentMode === 'Cash' ? defaultCashId : defaultBankId);
        if (accId) {
          const acc = accounts.find(a => a.id === accId);
          list.push({
            id: `exp_${exp.id}`,
            date: exp.date || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' }),
            type: 'Expense',
            category: exp.category || 'Expense',
            description: `Expense: ${exp.description}${exp.vendor_name ? ` (${exp.vendor_name})` : ''}`,
            amount: actualPaid,
            accountId: accId,
            accountName: acc?.name || 'Account',
            sourceModule: 'Expense',
            rawEntry: exp
          });
        }
      }
    });

    // 3. POS Sales (Only offline / un-synced sales not in bankTransactions)
    sales.forEach(sale => {
      if (sale.status === 'Completed' && sale.total > 0) {
        const isCash = sale.payment_mode === 'Cash';
        const isOnline = sale.payment_mode === 'Online';
        if (isCash || isOnline) {
          const isAlreadyInBankTx = btxIds.has(`btx_${sale.id}`) || 
            btxRefIds.has(sale.id) || 
            (sale.bill_number && btxBillTokens.has(sale.bill_number));

          if (!isAlreadyInBankTx) {
            const targetAccId = (sale as any).receipt_account_id || (isCash ? defaultCashId : defaultBankId);
            if (targetAccId) {
              const acc = accounts.find(a => a.id === targetAccId);
              list.push({
                id: `sale_${sale.id}`,
                date: sale.date ? sale.date.split('T')[0] : new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' }),
                type: 'Income',
                category: isCash ? 'Cash Sale' : 'Online Sale',
                description: `POS Sale #${sale.bill_number}${sale.customer_name ? ` (${sale.customer_name})` : ''}`,
                amount: sale.total || 0,
                accountId: targetAccId,
                accountName: acc?.name || 'Account',
                sourceModule: 'POS Sale',
                rawEntry: sale
              });
            }
          }
        }
      }
    });

    // 4. Customer Payments (Only offline / un-synced not in bankTransactions)
    customerTransactions.forEach(ct => {
      if (ct.type === 'Payment' && ct.amount > 0) {
        const modeLower = String(ct.mode || (ct as any).details?.mode || '').toLowerCase();
        if (
          modeLower.includes('bad debt') || 
          modeLower.includes('waiver') || 
          modeLower.includes('write-off') || 
          modeLower.includes('discount') || 
          modeLower.includes('opening balance') ||
          ct.id.startsWith('ctx_op_')
        ) {
          return;
        }

        const isAlreadyInBankTx = btxIds.has(`btx_${ct.id}`) || 
          btxIds.has(`btx_cust_${ct.id}`) || 
          btxRefIds.has(ct.id);

        if (!isAlreadyInBankTx) {
          const cust = customers.find(c => c.id === ct.customer_id);
          const isCash = !ct.mode || ct.mode.toLowerCase().includes('cash');
          const targetAccId = (ct as any).account_id || (ct as any).details?.account_id || (isCash ? defaultCashId : defaultBankId);
          
          if (targetAccId) {
            const acc = accounts.find(a => a.id === targetAccId);
            list.push({
              id: `cust_${ct.id}`,
              date: ct.date || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' }),
              type: 'Income',
              category: 'Customer Receipt',
              description: `Payment from: ${cust?.name || 'Customer'}${ct.note ? ` (${ct.note})` : ''}`,
              amount: ct.amount,
              accountId: targetAccId,
              accountName: acc?.name || 'Account',
              sourceModule: 'Customer Payment',
              rawEntry: ct
            });
          }
        }
      }
    });

    // 5. Supplier Payments (Only offline / un-synced not in bankTransactions)
    supplierTransactions.forEach(st => {
      if ((st.type === 'Payment' || st.type === 'Advance') && st.amount > 0) {
        const modeLower = String(st.mode || (st as any).details?.mode || '').toLowerCase();
        if (
          modeLower.includes('waiver') || 
          modeLower.includes('discount') || 
          modeLower.includes('opening balance') ||
          st.id.startsWith('stx_op_')
        ) {
          return;
        }

        const purchaseId = st.details?.purchase_id || (st.id.startsWith('stx_pur_') ? st.id.replace('stx_pur_', '') : null);
        const btxEquivalentId = st.id.replace(/^stx_/, 'btx_');
        const isAlreadyInBankTx = btxIds.has(btxEquivalentId) ||
          btxIds.has(`btx_${st.id}`) || 
          btxRefIds.has(st.id) || 
          (purchaseId && (btxIds.has(`btx_pur_${purchaseId}`) || btxRefIds.has(purchaseId) || btxRefIds.has(`pur_${purchaseId}`)));

        if (!isAlreadyInBankTx) {
          const supp = suppliers.find(s => s.id === st.supplier_id);
          const isCash = !st.mode || st.mode.toLowerCase().includes('cash');
          const targetAccId = (st as any).account_id || (st as any).details?.account_id || (isCash ? defaultCashId : defaultBankId);
          
          if (targetAccId) {
            const acc = accounts.find(a => a.id === targetAccId);
            list.push({
              id: `supp_${st.id}`,
              date: st.date || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' }),
              type: 'Expense',
              category: 'Supplier Payment',
              description: `Payment to: ${supp?.name || 'Supplier'}${st.note ? ` (${st.note})` : ''}`,
              amount: st.amount,
              accountId: targetAccId,
              accountName: acc?.name || 'Account',
              sourceModule: 'Supplier Payment',
              rawEntry: st
            });
          }
        }
      }
    });

    // Stable sort: by timestamp desc (newest first), fallback to ID desc
    return list.sort((a, b) => {
      const timeA = new Date(a.date).getTime();
      const timeB = new Date(b.date).getTime();
      if (timeA !== timeB) return timeB - timeA;
      return b.id.localeCompare(a.id);
    });
  }, [bankTransactions, expenses, sales, customerTransactions, supplierTransactions, accounts, settings, customers, suppliers]);

  // Transaction count helper
  const getAccountTransactionCount = (accountId: string) => {
    return unifiedEntries.filter(tx => tx.accountId === accountId).length;
  };

  // Filtered Wallets for Left Panel
  const filteredAccounts = useMemo(() => {
    return accounts.filter(acc => {
      const matchesSearch = !walletSearch.trim() || 
        acc.name.toLowerCase().includes(walletSearch.toLowerCase()) ||
        (acc.bank_name && acc.bank_name.toLowerCase().includes(walletSearch.toLowerCase())) ||
        (acc.account_number && acc.account_number.toLowerCase().includes(walletSearch.toLowerCase()));
      
      const matchesType = walletTypeFilter === 'All' || acc.type === walletTypeFilter;
      return matchesSearch && matchesType;
    });
  }, [accounts, walletSearch, walletTypeFilter]);

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [selectedAccountId, ledgerSearch, ledgerTypeFilter]);

  // Filtered transactions based on selected account and search/type
  const filteredTransactions = useMemo(() => {
    let list = unifiedEntries;

    // Filter by selected account
    if (selectedAccountId !== 'all') {
      list = list.filter(tx => tx.accountId === selectedAccountId);
    }

    // Filter by search term
    if (ledgerSearch.trim()) {
      const q = ledgerSearch.toLowerCase();
      list = list.filter(tx => 
        tx.description.toLowerCase().includes(q) || 
        tx.category.toLowerCase().includes(q) ||
        tx.accountName.toLowerCase().includes(q)
      );
    }

    // Filter by type
    if (ledgerTypeFilter === 'Inflow') {
      list = list.filter(tx => ['Deposit', 'Income', 'Transfer_In'].includes(tx.type));
    } else if (ledgerTypeFilter === 'Outflow') {
      list = list.filter(tx => ['Withdrawal', 'Expense', 'Transfer_Out'].includes(tx.type));
    } else if (ledgerTypeFilter === 'Transfer') {
      list = list.filter(tx => tx.type.includes('Transfer'));
    }

    return list;
  }, [unifiedEntries, selectedAccountId, ledgerSearch, ledgerTypeFilter]);

  // Paginated slice for desktop & mobile
  const totalPages = Math.max(1, Math.ceil(filteredTransactions.length / pageSize));
  const paginatedTransactions = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredTransactions.slice(start, start + pageSize);
  }, [filteredTransactions, currentPage, pageSize]);

  // Calculations for the selected view
  const stats = useMemo(() => {
    const accountEntries = selectedAccountId === 'all' 
      ? unifiedEntries 
      : unifiedEntries.filter(t => t.accountId === selectedAccountId);

    const inflow = accountEntries
      .filter(t => ['Deposit', 'Income', 'Transfer_In'].includes(t.type))
      .reduce((sum, t) => sum + t.amount, 0);

    const outflow = accountEntries
      .filter(t => ['Withdrawal', 'Expense', 'Transfer_Out'].includes(t.type))
      .reduce((sum, t) => sum + t.amount, 0);

    const balance = selectedAccountId === 'all'
      ? accounts.reduce((sum, a) => sum + a.balance, 0)
      : (selectedAccount?.balance || 0);

    return { balance, inflow, outflow, count: accountEntries.length };
  }, [unifiedEntries, selectedAccountId, accounts, selectedAccount]);

  // Total Consolidated Balance across all accounts
  const totalConsolidatedBalance = useMemo(() => {
    return accounts.reduce((sum, a) => sum + a.balance, 0);
  }, [accounts]);

  interface ContraAccountOption {
    id: string;
    name: string;
    type: string;
    label: string;
    hint: string;
  }

  interface ContraGroup {
    groupLabel: string;
    accounts: ContraAccountOption[];
  }

  // Filter and categorize contra accounts strictly relevant to Deposit vs Withdrawal
  const contraGroups = useMemo<ContraGroup[]>(() => {
    const activeManual = manualAccounts.filter(acc => acc.isActive !== false);

    if (transactionType === 'Deposit') {
      // 1. Owner's Equity & Capital (Excluding pure drawings)
      const capitalAccounts = activeManual.filter(acc => 
        acc.type === 'Equity' && 
        !acc.name.toLowerCase().includes('drawing') && 
        (acc as any).parentId !== 'sys_eq_draw_group'
      );
      // 2. Loans & Financing (Liabilities)
      const loanAccounts = activeManual.filter(acc => acc.type === 'Liability');
      // 3. Direct & Other Income (Income)
      const incomeAccounts = activeManual.filter(acc => acc.type === 'Income');

      const groups: ContraGroup[] = [];
      if (capitalAccounts.length > 0) {
        groups.push({
          groupLabel: "Owner's Equity & Capital",
          accounts: capitalAccounts.map(a => ({
            id: a.id,
            name: a.name,
            type: a.type,
            label: `${a.name} (Equity)`,
            hint: "Invested by owner into the business. Increases Owner's Capital in Balance Sheet."
          }))
        });
      }
      if (loanAccounts.length > 0) {
        groups.push({
          groupLabel: "Loans & Borrowings (Liabilities)",
          accounts: loanAccounts.map(a => ({
            id: a.id,
            name: a.name,
            type: a.type,
            label: `${a.name} (Liability)`,
            hint: "Loan/borrowed funds received from bank or partner. Updates liability obligations."
          }))
        });
      }
      if (incomeAccounts.length > 0) {
        groups.push({
          groupLabel: "Direct & Miscellaneous Income",
          accounts: incomeAccounts.map(a => ({
            id: a.id,
            name: a.name,
            type: a.type,
            label: `${a.name} (Income)`,
            hint: "Incidental receipts or scrap revenue not from core retail billing."
          }))
        });
      }
      return groups;
    } else {
      // Withdrawal
      // 1. Owner's Drawings (Excluding pure capital accounts)
      const drawingAccounts = activeManual.filter(acc => 
        acc.type === 'Equity' && 
        (acc.name.toLowerCase().includes('drawing') || (acc as any).parentId === 'sys_eq_draw_group' || !acc.name.toLowerCase().includes('capital'))
      );
      // 2. Loan Repayments (Liabilities)
      const loanAccounts = activeManual.filter(acc => acc.type === 'Liability');
      // 3. Fixed Assets & CapEx (Assets)
      const assetAccounts = activeManual.filter(acc => acc.type === 'Asset');

      const groups: ContraGroup[] = [];
      if (drawingAccounts.length > 0) {
        groups.push({
          groupLabel: "Owner's Equity & Personal Drawings",
          accounts: drawingAccounts.map(a => ({
            id: a.id,
            name: a.name,
            type: a.type,
            label: `${a.name} (Equity)`,
            hint: "Withdrawn by owner for personal expenses. Deducts from Owner's Equity in Balance Sheet."
          }))
        });
      }
      if (loanAccounts.length > 0) {
        groups.push({
          groupLabel: "Loan Repayments (Liabilities)",
          accounts: loanAccounts.map(a => ({
            id: a.id,
            name: a.name,
            type: a.type,
            label: `${a.name} (Liability Repayment)`,
            hint: "Repaying principal loan borrowed. Reduces liability balance."
          }))
        });
      }
      if (assetAccounts.length > 0) {
        groups.push({
          groupLabel: "Fixed Assets & Equipment (CapEx)",
          accounts: assetAccounts.map(a => ({
            id: a.id,
            name: a.name,
            type: a.type,
            label: `${a.name} (Asset Purchase)`,
            hint: "Capital expenditure purchasing machinery, furniture, or equipment."
          }))
        });
      }
      return groups;
    }
  }, [manualAccounts, transactionType]);

  const selectedContraAccount = useMemo(() => {
    if (!transactionData.relatedAccountId) return null;
    for (const grp of contraGroups) {
      const match = grp.accounts.find(a => a.id === transactionData.relatedAccountId);
      if (match) return match;
    }
    const directMatch = manualAccounts.find(a => a.id === transactionData.relatedAccountId);
    if (directMatch) {
      return {
        id: directMatch.id,
        name: directMatch.name,
        type: directMatch.type,
        label: `${directMatch.name} (${directMatch.type})`,
        hint: `Account classified under ${directMatch.type}`
      };
    }
    return null;
  }, [contraGroups, transactionData.relatedAccountId, manualAccounts]);

  // Handlers
  const handleOpenTransaction = (type: 'Deposit' | 'Withdrawal') => {
    setTransactionType(type);
    
    // Auto-select the most relevant default account:
    // Deposit -> Owner Capital
    // Withdrawal -> Owner Drawings
    let defaultContraId = '';
    if (type === 'Deposit') {
      const capAcc = manualAccounts.find(a => 
        a.isActive !== false && 
        a.type === 'Equity' && 
        (a.id === 'ma_owner_capital' || a.name.toLowerCase().includes('capital'))
      );
      if (capAcc) defaultContraId = capAcc.id;
    } else {
      const drawAcc = manualAccounts.find(a => 
        a.isActive !== false && 
        a.type === 'Equity' && 
        (a.id === 'ma_owner_drawings' || a.name.toLowerCase().includes('drawing'))
      );
      if (drawAcc) defaultContraId = drawAcc.id;
    }

    setTransactionData({
      accountId: selectedAccountId !== 'all' ? selectedAccountId : accounts[0]?.id || '',
      amount: '',
      description: '',
      date: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' }),
      relatedAccountId: defaultContraId
    });
    setIsTransactionOpen(true);
  };

  const handleTransactionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!transactionData.accountId || !transactionData.amount || isSubmitting) return;

    const amount = parseFloat(transactionData.amount);
    let categoryName: string = transactionType;

    // Handle Double Entry Logic if Contra Account selected
    if (transactionData.relatedAccountId) {
       const contraAccount = manualAccounts.find(a => a.id === transactionData.relatedAccountId);
       if (contraAccount) {
          categoryName = contraAccount.name;
          
          let impact = 0;
          const isCreditNormal = ['Liability', 'Equity', 'Income'].includes(contraAccount.type);
          
          if (transactionType === 'Deposit') {
             impact = isCreditNormal ? amount : -amount;
          } else {
             impact = isCreditNormal ? -amount : amount;
          }

          updateManualAccount(contraAccount.id, { balance: contraAccount.balance + impact });
       }
    }

    setIsSubmitting(true);
    try {
      await recordBankTransaction({
         account_id: transactionData.accountId,
         amount: amount,
         date: transactionData.date,
         description: transactionData.description || (transactionType === 'Deposit' ? 'Received' : 'Paid'),
         type: transactionType,
         category: categoryName,
         related_account_id: transactionData.relatedAccountId
      });

      showToast(`${transactionType} record ho gaya`, "success");
      setIsTransactionOpen(false);
      
      // Reset Form
      setTransactionData({ 
        accountId: '', 
        amount: '', 
        description: '', 
        date: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' }), 
        relatedAccountId: '' 
      });
    } catch (err: any) {
      showToast("Transaction record nahi hui: " + (err?.message || "dobara koshish karein"), "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleTransferSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!transferData.fromId || !transferData.toId || !transferData.amount || isSubmittingTransfer) return;
    if (transferData.fromId === transferData.toId) { showToast("Jis account se aur jis mein bhej rahe hain, dono alag hone chahiyen", "error"); return; }
    
    const transferAmount = parseFloat(transferData.amount);
    if (isNaN(transferAmount) || transferAmount <= 0) {
      showToast("Transfer amount 0 se zyada likhein", "warning");
      return;
    }

    const sourceAccount = accounts.find(a => a.id === transferData.fromId);
    if (sourceAccount && sourceAccount.balance < transferAmount) {
      const confirmOverdraft = await confirmAction({
        tone: 'warning',
        title: 'Account mein itna balance nahi',
        message: `"${sourceAccount.name}" mein ${formatCurrency(sourceAccount.balance)} hain, aur transfer ${formatCurrency(transferAmount)} ka hai.`,
        consequences: [
          `Transfer ke baad "${sourceAccount.name}" ka balance ${formatCurrency(sourceAccount.balance - transferAmount)} (minus) ho jayega.`,
          'Baad mein yeh farq bank statement se milana hoga.',
        ],
        confirmLabel: 'Phir bhi transfer karein',
      });
      if (!confirmOverdraft) return;
    }

    setIsSubmittingTransfer(true);
    try {
      const ok = await transferFunds(transferData.fromId, transferData.toId, transferAmount, transferData.date, transferData.description);
      if (!ok) return;
      showToast("Raqam transfer ho gayi", "success");
      setIsTransferOpen(false);
      setTransferData({ fromId: '', toId: '', amount: '', description: '', date: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' }) });
    } catch (err: any) {
      showToast("Transfer nahi hua: " + (err?.message || "dobara koshish karein"), "error");
    } finally {
      setIsSubmittingTransfer(false);
    }
  };

  const handleAddAccountSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accountData.name?.trim() || isSubmittingAccount) return;
    
    setIsSubmittingAccount(true);
    try {
      const ok = await addAccount(accountData as any);
      if (!ok) return;
      showToast("Naya account ban gaya", "success");
      setIsAddAccountOpen(false);
      setAccountData({ name: '', type: 'Bank', balance: 0, isActive: true, bank_name: '', account_number: '' });
    } catch (err: any) {
      showToast("Account nahi ban saka: " + (err?.message || "dobara koshish karein"), "error");
    } finally {
      setIsSubmittingAccount(false);
    }
  };

  const handleOpenEditAccount = (acc: FinancialAccount) => {
    setEditingAccount(acc);
    setEditAccountFormData({
      name: acc.name,
      type: acc.type,
      bank_name: acc.bank_name || '',
      account_number: acc.account_number || '',
      isDrawer: acc.type === 'Cash' ? acc.isDrawer === true : undefined,
      isActive: acc.isActive !== false
    });
    setIsEditAccountOpen(true);
  };

  const handleEditAccountSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingAccount || !editAccountFormData.name?.trim() || isSubmittingAccount) return;

    setIsSubmittingAccount(true);
    try {
      const success = await updateAccount(editingAccount.id, editAccountFormData);
      if (success) {
        showToast(`Account "${editAccountFormData.name}" update ho gaya`, "success");
        setIsEditAccountOpen(false);
        setEditingAccount(null);
      } else {
        showToast("Account update nahi hua", "error");
      }
    } catch (err: any) {
      showToast("Account update nahi hua: " + (err?.message || "dobara koshish karein"), "error");
    } finally {
      setIsSubmittingAccount(false);
    }
  };

  const handleDeleteAccount = async (acc: FinancialAccount) => {
    const assessment = getDeleteAssessment('account', acc.id);
    
    if (assessment.balance !== 0) {
      showToast(`"${acc.name}" delete nahi ho sakta: is mein abhi ${formatCurrency(acc.balance)} balance hai. Pehle sari raqam doosre account mein transfer karein.`, "error");
      return;
    }

    if (assessment.hasHistory) {
      const deactivate = await confirmAction({
        tone: 'warning',
        title: `"${acc.name}" Inactive karein?`,
        message: `Is account mein ${assessment.details?.txCount || 0} transaction(s) record hain, is liye yeh delete nahi hoga balkay Inactive ho jayega.`,
        consequences: [
          'Purani transactions aur bank statement waise hi rahenge.',
          'Naye payment aur transfer mein yeh account nazar nahi aayega.',
          'Baad mein isay dobara Active kiya ja sakta hai.',
        ],
        confirmLabel: 'Haan, Inactive karein',
      });
      if (deactivate) {
        const success = await safeDeleteAccount(acc.id, 'deactivate');
        if (success) {
          showToast(`Account "${acc.name}" Inactive ho gaya`, "info");
          if (selectedAccountId === acc.id) {
            setSelectedAccountId('all');
          }
        }
      }
      return;
    }

    const hardDelete = await confirmAction({
      title: `"${acc.name}" delete karein?`,
      message: 'Is account mein koi transaction nahi, is liye yeh hamesha ke liye hat jayega.',
      consequences: ['Yeh kaam wapas nahi ho sakta.'],
    });
    if (hardDelete) {
      const success = await safeDeleteAccount(acc.id, 'hard_delete');
      if (success) {
        if (selectedAccountId === acc.id) {
          setSelectedAccountId('all');
        }
      }
    }
  };

  const inputClass = "w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs font-semibold text-slate-800 outline-none focus:bg-white focus:border-lime-500 focus:ring-2 focus:ring-lime-500/10 transition-all shadow-inner";
  const labelClass = "block text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-1 ml-0.5";

  // --- Animation Variants ---
  const modalOverlay = {
    hidden: { opacity: 0 },
    visible: { opacity: 1 },
    exit: { opacity: 0 }
  };
  
  const modalContent = {
    hidden: { scale: 0.95, opacity: 0, y: 15 },
    visible: { scale: 1, opacity: 1, y: 0, transition: { type: 'spring', damping: 25, stiffness: 300 } },
    exit: { scale: 0.95, opacity: 0, y: 15 }
  };

  return (
    <div className="flex flex-col md:flex-row h-[calc(100vh-5.5rem)] md:h-[calc(100vh-6.5rem)] gap-3 md:gap-4 overflow-hidden">
      
      {/* ========================================================================= */}
      {/* --- LEFT PANEL: WALLETS & ACCOUNTS DIRECTORY ---                           */}
      {/* Visible on Desktop ALWAYS (>= md), on Mobile ONLY when Ledger NOT open     */}
      {/* ========================================================================= */}
      <div className={`w-full md:w-80 lg:w-88 flex-col bg-white rounded-2xl border border-slate-200/90 shadow-2xs shrink-0 overflow-hidden h-full ${
        isMobileLedgerOpen ? 'hidden md:flex' : 'flex'
      }`}>
         
         {/* Top Action Bar (Compact Header) */}
         <div className="p-3 border-b border-slate-200/80 bg-white space-y-2 shrink-0">
            <div className="flex items-center justify-between">
               <div>
                  <h3 className="font-black text-sm text-slate-900">My Wallets</h3>
                  <p className="text-[10px] text-slate-400 font-medium">Select account to view entries</p>
               </div>
               <button 
                 onClick={() => setIsAddAccountOpen(true)}
                 className="px-2.5 py-1.5 bg-lime-600 hover:bg-lime-700 text-white rounded-xl text-xs font-bold flex items-center gap-1 shadow-xs transition-all shrink-0 cursor-pointer active:scale-95"
                 title="Add New Bank / Wallet"
               >
                  <Plus size={14} />
                  <span>Add</span>
               </button>
            </div>

            {/* Search Input */}
            <div className="relative">
               <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
               <input
                 type="text"
                 placeholder="Search wallet, bank, acc#..."
                 className="w-full pl-8.5 pr-7 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:border-lime-500 transition-all shadow-inner"
                 value={walletSearch}
                 onChange={e => setWalletSearch(e.target.value)}
               />
               {walletSearch && (
                  <button aria-label="Hatayen" onClick={() => setWalletSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5 cursor-pointer">
                     <X size={12} />
                  </button>
               )}
            </div>

            {/* Filter Pills */}
            <div className="flex gap-1 overflow-x-auto pb-0.5 no-scrollbar text-[11px] font-semibold">
               {(['All', 'Cash', 'Bank', 'Wallet'] as const).map(type => (
                  <button
                    key={type}
                    onClick={() => setWalletTypeFilter(type)}
                    className={`px-2.5 py-1 rounded-lg transition-all shrink-0 cursor-pointer ${
                       walletTypeFilter === type
                          ? 'bg-lime-600 text-white shadow-xs font-semibold'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200/80'
                    }`}
                  >
                     {type}
                  </button>
               ))}
            </div>
         </div>

         {/* Accounts List Cards */}
         <div className="flex-1 overflow-y-auto p-2.5 sm:p-3 space-y-2">
            
            {/* 'All Accounts' Consolidated Hero Card */}
            {(!walletSearch || 'all accounts consolidated'.includes(walletSearch.toLowerCase())) && walletTypeFilter === 'All' && (
               <button 
                  onClick={() => selectAccount('all')}
                  className={`w-full text-left p-3.5 rounded-2xl border transition-all group relative overflow-hidden cursor-pointer ${
                     selectedAccountId === 'all' 
                        ? 'border-lime-500 bg-gradient-to-br from-lime-600 to-emerald-700 text-white shadow-md ring-2 ring-lime-500/30' 
                        : 'border-slate-200 bg-white text-slate-900 hover:border-lime-400/50 shadow-xs'
                  }`}
               >
                  <div className="flex items-center justify-between gap-3 relative z-10">
                     <div className="flex items-center gap-2.5 min-w-0">
                        <div className={`p-2.5 rounded-xl border shrink-0 ${
                           selectedAccountId === 'all'
                              ? 'bg-white/20 text-white border-white/30'
                              : 'bg-lime-50 text-lime-700 border-lime-200'
                        }`}>
                           <Briefcase size={17} />
                        </div>
                        <div className="min-w-0">
                           <p className={`text-[10px] font-bold uppercase tracking-wider truncate ${
                              selectedAccountId === 'all' ? 'text-lime-100' : 'text-slate-400'
                           }`}>Consolidated Total</p>
                           <h4 className="text-sm sm:text-base font-bold font-mono tracking-tight truncate">
                              {formatCurrency(totalConsolidatedBalance)}
                           </h4>
                        </div>
                     </div>
                     <div className="text-right shrink-0">
                        <span className="inline-block px-2 py-0.5 bg-white/10 text-lime-300 rounded-lg text-[10px] font-bold">
                           {accounts.length} Accounts
                        </span>
                     </div>
                  </div>
               </button>
            )}

            {/* Individual Accounts Cards */}
            {filteredAccounts.map(acc => {
               const isActive = selectedAccountId === acc.id;
               const isCash = acc.type === 'Cash';
               const isBank = acc.type === 'Bank';
               const txCount = getAccountTransactionCount(acc.id);
               
               return (
                  <button 
                     key={acc.id}
                     onClick={() => selectAccount(acc.id)}
                     className={`w-full text-left p-3 rounded-2xl border transition-all relative overflow-hidden group cursor-pointer ${
                        isActive 
                           ? 'bg-white border-lime-500 shadow-sm ring-2 ring-lime-500/20' 
                           : 'bg-white hover:bg-slate-50 border-slate-200 hover:border-slate-300 shadow-2xs'
                     }`}
                  >
                     <div className="flex items-start justify-between gap-2">
                        {/* Avatar & Details */}
                        <div className="flex items-center gap-2.5 min-w-0 flex-1">
                           <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-bold text-xs shrink-0 ${
                              isCash 
                                 ? 'bg-emerald-100 text-emerald-800' 
                                 : isBank 
                                    ? 'bg-blue-100 text-blue-800' 
                                    : 'bg-purple-100 text-purple-800'
                           }`}>
                              {isCash ? <Wallet size={16}/> : isBank ? <Building2 size={16}/> : <Smartphone size={16}/>}
                           </div>
                           <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                 <h4 className={`text-xs font-bold truncate ${isActive ? 'text-lime-950' : 'text-slate-900'}`}>{acc.name}</h4>
                                 {acc.is_default && (
                                    <span className="text-[9px] font-bold bg-slate-100 text-slate-600 px-1.5 py-0.2 rounded border border-slate-200 shrink-0">DEF</span>
                                 )}
                                 {acc.type === 'Cash' && acc.isDrawer && (
                                    <span className="text-[9px] font-bold bg-emerald-50 text-emerald-700 px-1.5 py-0.2 rounded border border-emerald-200 shrink-0">DRAWER</span>
                                 )}
                              </div>
                              <p className="text-[10px] text-slate-500 truncate flex items-center gap-1 mt-0.5">
                                 <span className="font-semibold text-slate-600">{acc.type}</span>
                                 {acc.account_number && (
                                    <>
                                       <span>•</span>
                                       <span className="font-mono">{acc.account_number}</span>
                                    </>
                                 )}
                              </p>
                           </div>
                        </div>

                        {/* Balance & Entries */}
                        <div className="text-right shrink-0">
                           <span className={`block text-xs font-black font-mono ${acc.balance < 0 ? 'text-rose-600' : 'text-slate-900'}`}>
                              {formatCurrency(acc.balance)}
                           </span>
                           <span className="text-[10px] text-slate-400 font-medium">
                              {txCount} entries
                           </span>
                        </div>
                     </div>
                  </button>
               );
            })}

            {filteredAccounts.length === 0 && (
               <div className="py-12 text-center text-slate-400">
                  <Wallet size={28} className="mx-auto text-slate-300 mb-1.5" />
                  <p className="font-semibold text-xs text-slate-600">No matching accounts found</p>
               </div>
            )}
         </div>
      </div>

      {/* ========================================================================= */}
      {/* --- RIGHT PANEL: SELECTED ACCOUNT HERO, STATS & ACTIVITY LEDGER ---        */}
      {/* Visible on Desktop ALWAYS (>= md), on Mobile ONLY when Ledger IS open      */}
      {/* ========================================================================= */}
      <div className={`flex-1 flex-col min-w-0 h-full gap-2.5 sm:gap-3 overflow-hidden ${
        !isMobileLedgerOpen ? 'hidden md:flex' : 'flex'
      }`}>
         
         {/* Top: Modern Responsive Hero Card */}
         <div className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white p-3.5 sm:p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs shrink-0 space-y-3">
            
            {/* Header Row: Back button (mobile) + Account Name + Actions */}
            <div className="flex items-center justify-between gap-2">
               <div className="flex items-center gap-2 min-w-0 flex-1">
                  {/* Mobile Back Button */}
                  <button aria-label="Back to Wallets" 
                    onClick={() => selectAccount('all')}
                    className="md:hidden p-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 active:scale-95 text-slate-700 dark:text-slate-200 rounded-xl transition-all shrink-0 cursor-pointer"
                    title="Back to Wallets"
                  >
                     <ArrowLeft size={16} />
                  </button>

                  <div className="min-w-0 flex-1">
                     <div className="flex items-center gap-2 flex-wrap">
                        <h2 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white truncate tracking-tight">
                           {selectedAccountId === 'all' ? 'All Accounts (Consolidated)' : selectedAccount?.name}
                        </h2>
                        {selectedAccountId !== 'all' && selectedAccount && (
                           <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider border ${
                              selectedAccount.type === 'Cash' 
                                 ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800/40' 
                                 : selectedAccount.type === 'Bank'
                                    ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800/40'
                                    : 'bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800/40'
                           }`}>
                              {selectedAccount.type}
                           </span>
                        )}
                     </div>

                     {selectedAccountId !== 'all' && selectedAccount?.account_number && (
                        <p className="text-[11px] font-mono text-slate-400 dark:text-slate-400 truncate mt-0.5">
                           Acc #: {selectedAccount.account_number} {selectedAccount.bank_name ? `(${selectedAccount.bank_name})` : ''}
                        </p>
                     )}
                  </div>
               </div>

                {/* Edit / Delete / Reactivate Buttons for Single Account */}
                {selectedAccountId !== 'all' && selectedAccount && (
                   <div className="flex items-center gap-1 shrink-0">
                      {selectedAccount.isActive === false && (
                        <button
                          onClick={async () => {
                            await reactivateEntity('account', selectedAccount.id);
                            showToast(`Account "${selectedAccount.name}" dobara Active ho gaya`, "success");
                          }}
                          className="px-2.5 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-bold flex items-center gap-1 shadow-xs cursor-pointer"
                          title="Reactivate Account"
                        >
                          <RotateCcw size={13} />
                          <span className="hidden sm:inline">Reactivate</span>
                        </button>
                      )}
                      <button aria-label="Edit Account Details" 
                        onClick={() => handleOpenEditAccount(selectedAccount)}
                        className="p-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl transition-all cursor-pointer"
                        title="Edit Account Details"
                      >
                         <Edit3 size={14} />
                      </button>
                      <button aria-label="Delete or Archive Account" 
                        onClick={() => handleDeleteAccount(selectedAccount)}
                        className="p-2 bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 dark:hover:bg-rose-900/50 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-800/40 rounded-xl transition-all cursor-pointer"
                        title="Delete or Archive Account"
                      >
                         <Trash2 size={14} />
                      </button>
                   </div>
                )}
            </div>

            {/* Financial Overview: Balance + Inflow / Outflow Pills */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1 border-t border-slate-100 dark:border-slate-800">
               {/* Current Balance */}
               <div className="bg-slate-50 dark:bg-slate-800/60 rounded-xl p-2.5 border border-slate-100 dark:border-slate-700/60">
                  <span className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-400 tracking-wider block">Current Balance</span>
                  <span className={`text-base sm:text-lg font-black font-mono block mt-0.5 ${stats.balance < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-900 dark:text-white'}`}>
                     {formatCurrency(stats.balance)}
                  </span>
               </div>

               {/* Total Inflow */}
               <div className="bg-emerald-50 dark:bg-emerald-950/40 rounded-xl p-2.5 border border-emerald-200/80 dark:border-emerald-800/40">
                  <div className="flex items-center justify-between">
                     <span className="text-[10px] uppercase font-bold text-emerald-800 dark:text-emerald-300 tracking-wider">Total Received (+)</span>
                     <ArrowDownLeft size={13} className="text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <span className="text-sm sm:text-base font-bold font-mono text-emerald-700 dark:text-emerald-300 block mt-0.5">
                     + {formatCurrency(stats.inflow)}
                  </span>
               </div>

               {/* Total Outflow */}
               <div className="bg-rose-50 dark:bg-rose-950/40 rounded-xl p-2.5 border border-rose-200/80 dark:border-rose-800/40">
                  <div className="flex items-center justify-between">
                     <span className="text-[10px] uppercase font-bold text-rose-800 dark:text-rose-300 tracking-wider">Total Paid (-)</span>
                     <ArrowUpRight size={13} className="text-rose-600 dark:text-rose-400" />
                  </div>
                  <span className="text-sm sm:text-base font-bold font-mono text-rose-700 dark:text-rose-300 block mt-0.5">
                     - {formatCurrency(stats.outflow)}
                  </span>
               </div>
            </div>

            {/* Cash In Transit: submitted to head but received into no account yet */}
            {selectedAccountId === 'all' && (cashInTransit?.amount || 0) > 0 && (
               <div className="flex items-start gap-2 rounded-xl bg-violet-50 dark:bg-violet-950/30 border border-violet-200 dark:border-violet-900 px-3 py-2">
                  <Clock3 size={13} className="text-violet-500 shrink-0 mt-0.5" />
                  <p className="text-xs font-bold text-violet-700 dark:text-violet-300 leading-relaxed">
                     Cash in Transit: {formatCurrency((cashInTransit?.amount || 0))} ({cashInTransit?.count || 0} remittance{(cashInTransit?.count || 0) > 1 ? 's' : ''} pending receive) — shift close par drawer se nikal chuki, kisi account men nahi.
                     Head receive karte hi is page ke accounts men aayegi. Total cash = accounts + in-transit.
                  </p>
               </div>
            )}

            {/* Quick Action Buttons */}
            <div className="grid grid-cols-3 gap-2 pt-1">
               <button 
                  onClick={() => setIsTransferOpen(true)}
                  className="py-2 px-3 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 active:scale-95 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-xl font-bold text-xs shadow-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer"
               >
                  <ArrowRightLeft size={14} className="text-indigo-600 dark:text-indigo-400" /> 
                  <span>Transfer</span>
               </button>
               <button 
                  onClick={() => handleOpenTransaction('Deposit')}
                  className="py-2 px-3 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white rounded-xl font-bold text-xs shadow-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer"
               >
                  <ArrowDownLeft size={14} /> 
                  <span>Deposit</span>
               </button>
               <button 
                  onClick={() => handleOpenTransaction('Withdrawal')}
                  className="py-2 px-3 bg-rose-600 hover:bg-rose-700 active:scale-95 text-white rounded-xl font-bold text-xs shadow-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer"
               >
                  <ArrowUpRight size={14} /> 
                  <span>Withdraw</span>
               </button>
            </div>
         </div>

         {/* Bottom: Transaction Activity Feed & Ledger */}
         <div className="flex-1 bg-white rounded-2xl border border-slate-200/90 shadow-2xs overflow-hidden flex flex-col min-h-0">
            
            {/* Toolbar: Search + Type Filter Pills */}
            <div className="p-2.5 sm:p-3 border-b border-slate-200 bg-white flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-2 shrink-0">
               {/* Search Bar */}
               <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                  <input 
                    type="text" 
                    placeholder="Search entries, bills, parties..." 
                    className="w-full pl-8.5 pr-7 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:border-lime-500 transition-all shadow-inner" 
                    value={ledgerSearch} 
                    onChange={e => setLedgerSearch(e.target.value)} 
                  />
                  {ledgerSearch && (
                     <button aria-label="Hatayen" onClick={() => setLedgerSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5 cursor-pointer">
                        <X size={12} />
                     </button>
                  )}
               </div>

               {/* Filter Pills */}
               <div className="flex gap-1 overflow-x-auto pb-0.5 no-scrollbar text-[11px] font-semibold">
                  <button 
                    onClick={() => setLedgerTypeFilter('All')} 
                    className={`px-2.5 py-1 rounded-lg transition-all shrink-0 cursor-pointer ${
                       ledgerTypeFilter === 'All' ? 'bg-lime-600 text-white font-bold shadow-xs' : 'bg-slate-100 text-slate-600 hover:bg-slate-200/80'
                    }`}
                  >
                     All ({filteredTransactions.length})
                  </button>
                  <button 
                    onClick={() => setLedgerTypeFilter('Inflow')} 
                    className={`px-2.5 py-1 rounded-lg transition-all shrink-0 cursor-pointer ${
                       ledgerTypeFilter === 'Inflow' ? 'bg-emerald-600 text-white font-bold shadow-xs' : 'bg-emerald-50 text-emerald-800 border border-emerald-200/80'
                    }`}
                  >
                     Inflow (+)
                  </button>
                  <button 
                    onClick={() => setLedgerTypeFilter('Outflow')} 
                    className={`px-2.5 py-1 rounded-lg transition-all shrink-0 cursor-pointer ${
                       ledgerTypeFilter === 'Outflow' ? 'bg-rose-600 text-white font-bold shadow-xs' : 'bg-rose-50 text-rose-800 border border-rose-200/80'
                    }`}
                  >
                     Outflow (-)
                  </button>
                  <button 
                    onClick={() => setLedgerTypeFilter('Transfer')} 
                    className={`px-2.5 py-1 rounded-lg transition-all shrink-0 cursor-pointer ${
                       ledgerTypeFilter === 'Transfer' ? 'bg-indigo-600 text-white font-bold shadow-xs' : 'bg-indigo-50 text-indigo-800 border border-indigo-200/80'
                    }`}
                  >
                     Transfers
                  </button>
               </div>
            </div>

            {/* 1. DESKTOP VIEW: Table (Hidden on Mobile) */}
            <div className="hidden md:block flex-1 overflow-y-auto">
               <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50/90 sticky top-0 z-10 border-b border-slate-200 text-slate-500 font-bold uppercase text-[10px] tracking-wider">
                     <tr>
                        <th className="px-4 py-3">Date</th>
                        <th className="px-4 py-3">Description & Details</th>
                        <th className="px-4 py-3">Category & Source</th>
                        <th className="px-4 py-3 text-right">Amount (Rs)</th>
                        {selectedAccountId === 'all' && <th className="px-4 py-3 text-right">Wallet / Account</th>}
                     </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700 font-medium">
                     {paginatedTransactions.map(tx => {
                        const isCredit = ['Deposit', 'Income', 'Transfer_In'].includes(tx.type);
                        const isTransfer = tx.type.includes('Transfer');
                        
                        return (
                           <tr key={tx.id} className="hover:bg-lime-50/20 transition-colors group">
                              <td className="px-4 py-3 whitespace-nowrap">
                                 <span className="font-semibold text-slate-800 font-mono text-[11px] bg-slate-100 px-2 py-0.5 rounded">
                                    {new Date(tx.date).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })}
                                 </span>
                              </td>
                              <td className="px-4 py-3">
                                 <div className="font-bold text-slate-800 flex items-center gap-1.5 truncate max-w-sm">
                                    {isTransfer && <ArrowRightLeft size={13} className="text-indigo-600 shrink-0"/>}
                                    <span className="truncate">{tx.description}</span>
                                 </div>
                              </td>
                              <td className="px-4 py-3">
                                 <div className="flex items-center gap-1.5">
                                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide border ${
                                       isTransfer 
                                          ? 'bg-indigo-50 text-indigo-700 border-indigo-200' 
                                          : isCredit 
                                             ? 'bg-emerald-50 text-emerald-700 border-emerald-200' 
                                             : 'bg-rose-50 text-rose-700 border-rose-200'
                                    }`}>
                                       {tx.category}
                                    </span>
                                    <span className="text-[10px] text-slate-400 font-medium">
                                       ({tx.sourceModule})
                                    </span>
                                 </div>
                              </td>
                              <td className={`px-4 py-3 text-right font-black font-mono text-xs whitespace-nowrap ${isCredit ? 'text-emerald-700' : 'text-rose-700'}`}>
                                 {isCredit ? '+' : '-'} {formatCurrency(tx.amount)}
                              </td>
                              {selectedAccountId === 'all' && (
                                 <td className="px-4 py-3 text-right text-xs font-bold text-slate-600 truncate max-w-[120px]">
                                    {tx.accountName}
                                 </td>
                              )}
                           </tr>
                        );
                     })}
                     {filteredTransactions.length === 0 && (
                        <tr>
                           <td colSpan={selectedAccountId === 'all' ? 5 : 4} className="py-12 text-center text-slate-400 italic text-xs">
                              No entries found for this view.
                           </td>
                        </tr>
                     )}
                  </tbody>
               </table>
            </div>

            {/* 2. MOBILE VIEW: Timeline Cards (Hidden on Desktop) */}
            <div className="block md:hidden flex-1 overflow-y-auto p-2.5 space-y-2">
               {paginatedTransactions.map(tx => {
                  const isCredit = ['Deposit', 'Income', 'Transfer_In'].includes(tx.type);
                  const isTransfer = tx.type.includes('Transfer');

                  return (
                     <div 
                       key={tx.id}
                       className="bg-white p-3 rounded-2xl border border-slate-200/90 shadow-2xs space-y-1.5"
                     >
                        <div className="flex items-center justify-between gap-2">
                           <span className="text-[10px] font-mono font-bold text-slate-600 bg-slate-100 px-2 py-0.5 rounded">
                              {new Date(tx.date).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })}
                           </span>
                           <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider border ${
                              isTransfer 
                                 ? 'bg-indigo-50 text-indigo-700 border-indigo-200' 
                                 : isCredit 
                                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200' 
                                    : 'bg-rose-50 text-rose-700 border-rose-200'
                           }`}>
                              {tx.category} • {tx.sourceModule}
                           </span>
                        </div>

                        <div className="flex items-start justify-between gap-2 pt-0.5">
                           <div className="min-w-0 flex-1">
                              <p className="text-xs font-bold text-slate-900 leading-snug break-words">
                                 {tx.description}
                              </p>
                              {selectedAccountId === 'all' && (
                                 <p className="text-[10px] font-semibold text-slate-500 mt-0.5">
                                    Wallet: <span className="text-slate-700 font-bold">{tx.accountName}</span>
                                 </p>
                              )}
                           </div>
                           <div className="text-right shrink-0">
                              <span className={`text-xs font-black font-mono ${isCredit ? 'text-emerald-700' : 'text-rose-700'}`}>
                                 {isCredit ? '+' : '-'} {formatCurrency(tx.amount)}
                              </span>
                           </div>
                        </div>
                     </div>
                  );
               })}

               {filteredTransactions.length === 0 && (
                  <div className="py-12 text-center text-slate-400">
                     <History size={28} className="mx-auto text-slate-300 mb-1.5" />
                     <p className="font-semibold text-xs text-slate-600">No entries recorded</p>
                  </div>
               )}
            </div>

            {/* 3. PAGINATION CONTROLS */}
            {totalPages > 1 && (
               <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 bg-slate-50/90 border-t border-slate-200 text-xs text-slate-600 shrink-0">
                  <div className="flex items-center gap-1.5 font-medium">
                     <span>Showing</span>
                     <span className="font-bold font-mono text-slate-800">
                        {((currentPage - 1) * pageSize) + 1}
                     </span>
                     <span>to</span>
                     <span className="font-bold font-mono text-slate-800">
                        {Math.min(currentPage * pageSize, filteredTransactions.length)}
                     </span>
                     <span>of</span>
                     <span className="font-bold font-mono text-slate-800">
                        {filteredTransactions.length}
                     </span>
                     <span>entries</span>
                  </div>

                  <div className="flex items-center gap-1">
                     <button
                        type="button"
                        onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                        disabled={currentPage === 1}
                        className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                     >
                        <ChevronLeft size={13} />
                        <span>Prev</span>
                     </button>

                     <span className="px-3 py-1 font-mono font-bold text-xs bg-white border border-slate-200 rounded-lg">
                        Page {currentPage} of {totalPages}
                     </span>

                     <button
                        type="button"
                        onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                        disabled={currentPage === totalPages}
                        className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                     >
                        <span>Next</span>
                        <ChevronRight size={13} />
                     </button>
                  </div>
               </div>
            )}

         </div>
      </div>

      {/* ========================================================================= */}
      {/* --- GLOBAL MODALS & BOTTOM SHEETS (z-[100]) ---                          */}
      {/* ========================================================================= */}
      <AnimatePresence>
        {/* 1. Transaction Modal (Deposit / Withdrawal) */}
        {isTransactionOpen && (
           <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-4">
              <MotionDiv 
                initial="hidden" animate="visible" exit="hidden" variants={modalOverlay}
                className="absolute inset-0 bg-slate-950/60 backdrop-blur-xs" onClick={() => setIsTransactionOpen(false)} 
              />
              <MotionDiv 
                initial="hidden" animate="visible" exit="exit" variants={modalContent}
                className="relative bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden max-h-[92vh] flex flex-col"
              >
                 <div className={`px-5 py-4 border-b flex justify-between items-center shrink-0 ${transactionType === 'Deposit' ? 'bg-emerald-50 border-emerald-100' : 'bg-rose-50 border-rose-100'}`}>
                    <h3 className={`font-bold text-sm sm:text-base flex items-center gap-2 ${transactionType === 'Deposit' ? 'text-emerald-900' : 'text-rose-900'}`}>
                       {transactionType === 'Deposit' ? <ArrowDownLeft size={18} className="text-emerald-600"/> : <ArrowUpRight size={18} className="text-rose-600"/>}
                       {transactionType === 'Deposit' ? 'Record Deposit (Inflow)' : 'Record Withdrawal (Outflow)'}
                    </h3>
                    <button aria-label="Band karein" onClick={() => setIsTransactionOpen(false)} className="bg-white/80 p-1.5 rounded-full hover:bg-white text-slate-500 hover:text-slate-800 transition-colors cursor-pointer"><X size={15}/></button>
                 </div>
                 
                 <form onSubmit={handleTransactionSubmit} className="p-4 sm:p-5 space-y-3.5 overflow-y-auto flex-1">
                    <div className="bg-slate-50 p-3 rounded-2xl border border-slate-200">
                       <label className="text-[10px] font-bold text-slate-500 uppercase mb-1 block">
                          {transactionType === 'Deposit' ? 'Deposit Into (Target Account)' : 'Withdraw From (Source Account)'}
                       </label>
                       <select 
                         className="w-full bg-transparent font-bold text-slate-800 text-xs sm:text-sm outline-none cursor-pointer"
                         value={transactionData.accountId} onChange={e => setTransactionData({...transactionData, accountId: e.target.value})}
                       >
                          <option value="">Select Account...</option>
                          {accounts.map(a => <option key={a.id} value={a.id}>{a.name} ({formatCurrency(a.balance)})</option>)}
                       </select>
                    </div>

                    <div>
                       <label className={labelClass}>Amount (Rs)</label>
                       <div className="relative">
                          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 font-black text-sm">Rs</span>
                          <input 
                             type="number" required min="1" 
                             className={`${inputClass} pl-10 text-base font-black font-mono`} 
                             placeholder="0.00" value={transactionData.amount} onChange={e => setTransactionData({...transactionData, amount: e.target.value})} 
                             autoFocus
                          />
                       </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                       <div>
                          <label className={labelClass}>Date</label>
                          <input type="date" className={inputClass} value={transactionData.date} onChange={e => setTransactionData({...transactionData, date: e.target.value})} />
                       </div>
                       
                       {/* Contra Account Selection */}
                       <div>
                          <label className={labelClass}>
                             {transactionType === 'Deposit' ? 'Received From (Source Account)' : 'Paid To / For (Destination Account)'}
                          </label>
                          <select 
                            className={inputClass} 
                            value={transactionData.relatedAccountId} 
                            onChange={e => setTransactionData({...transactionData, relatedAccountId: e.target.value})}
                          >
                             {contraGroups.map(grp => (
                               <optgroup key={grp.groupLabel} label={grp.groupLabel}>
                                 {grp.accounts.map(acc => (
                                   <option key={acc.id} value={acc.id}>
                                     {acc.label}
                                   </option>
                                 ))}
                               </optgroup>
                             ))}
                             <optgroup label="Direct / Other">
                               <option value="">Direct Entry (No Contra Ledger)</option>
                             </optgroup>
                          </select>
                       </div>
                    </div>

                    {/* Dynamic Double Entry Impact Notice */}
                    {selectedContraAccount && (
                       <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200/80 dark:border-slate-700 text-[11px] text-slate-600 dark:text-slate-300 flex items-start gap-2">
                          <Sparkles size={14} className="shrink-0 text-emerald-600 dark:text-emerald-400 mt-0.5" />
                          <div className="leading-snug">
                             <span className="font-bold text-slate-800 dark:text-white block">{selectedContraAccount.label}</span>
                             <span className="text-slate-500 dark:text-slate-400">{selectedContraAccount.hint}</span>
                          </div>
                       </div>
                    )}

                    <div>
                       <label className={labelClass}>Description / Notes</label>
                       <input 
                          type="text" className={inputClass} 
                          placeholder="Brief details..." value={transactionData.description} onChange={e => setTransactionData({...transactionData, description: e.target.value})} 
                       />
                    </div>

                    <button 
                      type="submit" 
                      disabled={isSubmitting}
                      className={`w-full py-3 rounded-xl font-bold text-xs sm:text-sm text-white shadow-md transition-all flex items-center justify-center gap-1.5 cursor-pointer mt-2 ${
                        isSubmitting 
                          ? 'bg-slate-400 cursor-not-allowed shadow-none'
                          : (transactionType === 'Deposit' ? 'bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98]' : 'bg-rose-600 hover:bg-rose-700 active:scale-[0.98]')
                      }`}
                    >
                       {isSubmitting ? (
                         <>
                           <Loader2 size={16} className="animate-spin" /> Saving...
                         </>
                       ) : (
                         `Confirm ${transactionType}`
                       )}
                    </button>
                 </form>
              </MotionDiv>
           </div>
        )}

        {/* 2. Transfer Modal */}
        {isTransferOpen && (
           <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-4">
              <MotionDiv 
                initial="hidden" animate="visible" exit="hidden" variants={modalOverlay}
                className="absolute inset-0 bg-slate-950/60 backdrop-blur-xs" onClick={() => setIsTransferOpen(false)} 
              />
              <MotionDiv 
                initial="hidden" animate="visible" exit="exit" variants={modalContent}
                className="relative bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden max-h-[92vh] flex flex-col"
              >
                 <div className="px-5 py-4 border-b border-indigo-100 bg-indigo-50/80 flex justify-between items-center shrink-0">
                    <h3 className="font-bold text-sm sm:text-base text-indigo-950 flex items-center gap-2"><ArrowRightLeft size={18} className="text-indigo-600"/> Transfer Between Accounts</h3>
                    <button aria-label="Band karein" onClick={() => setIsTransferOpen(false)} className="bg-white/80 p-1.5 rounded-full hover:bg-white text-slate-500 hover:text-slate-800 transition-colors cursor-pointer"><X size={15}/></button>
                 </div>
                 
                 <form onSubmit={handleTransferSubmit} className="p-4 sm:p-5 space-y-3.5 overflow-y-auto flex-1">
                    <div className="space-y-3 bg-slate-50 p-3.5 rounded-2xl border border-slate-200">
                       <div>
                          <label className={labelClass}>Source (Transfer From)</label>
                          <select className={inputClass} value={transferData.fromId} onChange={e => setTransferData({...transferData, fromId: e.target.value})}>
                             <option value="">Select Source Account...</option>
                             {accounts.map(a => <option key={a.id} value={a.id}>{a.name} ({formatCurrency(a.balance)})</option>)}
                          </select>
                       </div>
                       <div>
                          <label className={labelClass}>Destination (Transfer To)</label>
                          <select className={inputClass} value={transferData.toId} onChange={e => setTransferData({...transferData, toId: e.target.value})}>
                             <option value="">Select Destination Account...</option>
                             {accounts.map(a => <option key={a.id} value={a.id}>{a.name} ({formatCurrency(a.balance)})</option>)}
                          </select>
                       </div>
                    </div>

                    <div>
                       <label className={labelClass}>Transfer Amount (Rs)</label>
                       <div className="relative">
                          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 font-black text-sm">Rs</span>
                          <input type="number" required min="1" className={`${inputClass} pl-10 text-base font-black font-mono text-indigo-950`} placeholder="0.00" value={transferData.amount} onChange={e => setTransferData({...transferData, amount: e.target.value})} autoFocus />
                       </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                       <div>
                          <label className={labelClass}>Date</label>
                          <input type="date" className={inputClass} value={transferData.date} onChange={e => setTransferData({...transferData, date: e.target.value})} />
                       </div>
                       <div>
                          <label className={labelClass}>Reason / Note</label>
                          <input type="text" className={inputClass} placeholder="e.g. Cash Deposit to Bank" value={transferData.description} onChange={e => setTransferData({...transferData, description: e.target.value})} />
                       </div>
                    </div>

                    <button 
                      type="submit" 
                      disabled={isSubmittingTransfer}
                      className={`w-full py-3 font-bold rounded-xl shadow-md transition-all mt-2 text-xs sm:text-sm cursor-pointer flex items-center justify-center gap-1.5 ${
                        isSubmittingTransfer ? 'bg-slate-400 text-white cursor-not-allowed shadow-none' : 'bg-indigo-600 hover:bg-indigo-700 text-white'
                      }`}
                    >
                       {isSubmittingTransfer ? (
                         <>
                           <Loader2 size={16} className="animate-spin" /> Processing...
                         </>
                       ) : (
                         'Process Transfer'
                       )}
                    </button>
                 </form>
              </MotionDiv>
           </div>
        )}

        {/* 3. Add Account Modal */}
        {isAddAccountOpen && (
           <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-4">
              <MotionDiv 
                initial="hidden" animate="visible" exit="hidden" variants={modalOverlay}
                className="absolute inset-0 bg-slate-950/60 backdrop-blur-xs" onClick={() => setIsAddAccountOpen(false)} 
              />
              <MotionDiv 
                initial="hidden" animate="visible" exit="exit" variants={modalContent}
                className="relative bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden max-h-[92vh] flex flex-col"
              >
                 <div className="px-5 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50 shrink-0">
                    <h3 className="font-bold text-sm sm:text-base text-slate-800">Add New Wallet / Bank</h3>
                    <button aria-label="Band karein" onClick={() => setIsAddAccountOpen(false)} className="bg-white p-1.5 rounded-full hover:bg-slate-100 text-slate-500 hover:text-slate-800 transition-colors cursor-pointer"><X size={15}/></button>
                 </div>
                 <form onSubmit={handleAddAccountSubmit} className="p-4 sm:p-5 space-y-3.5 overflow-y-auto flex-1">
                    <div>
                       <label className={labelClass}>Account Name</label>
                       <input type="text" className={inputClass} required placeholder="e.g. Shop Cash Counter" value={accountData.name} onChange={e => setAccountData({...accountData, name: e.target.value})} autoFocus />
                    </div>
                    <div>
                       <label className={labelClass}>Account Type</label>
                       <div className="grid grid-cols-3 gap-2">
                          {(['Cash', 'Bank', 'Wallet'] as const).map(t => (
                             <button
                                key={t} type="button"
                                onClick={() => setAccountData({...accountData, type: t, isDrawer: t === 'Cash' ? accountData.isDrawer : undefined})}
                                className={`py-2 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${accountData.type === t ? 'bg-lime-600 text-white border-lime-600 shadow-xs' : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'}`}
                             >
                                {t}
                             </button>
                          ))}
                       </div>
                    </div>
                    {accountData.type === 'Cash' && (
                       <label className="flex items-center justify-between gap-3 p-3 bg-slate-50 border border-slate-200 rounded-2xl cursor-pointer">
                          <div>
                             <p className="text-xs font-bold text-slate-700">Cash Drawer ke tor par enable</p>
                             <p className="text-[10px] text-slate-400 font-medium">Sirf enabled Cash accounts hi POS shifts / Cash Control men drawer bante hain</p>
                          </div>
                          <input
                            type="checkbox"
                            className="w-4 h-4 accent-lime-600 shrink-0"
                            checked={accountData.isDrawer === true}
                            onChange={e => setAccountData({...accountData, isDrawer: e.target.checked})}
                          />
                       </label>
                    )}
                    {accountData.type === 'Bank' && (
                       <MotionDiv initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="space-y-3">
                          <div>
                             <label className={labelClass}>Bank Name</label>
                             <input type="text" className={inputClass} placeholder="e.g. Meezan Bank" value={accountData.bank_name || ''} onChange={e => setAccountData({...accountData, bank_name: e.target.value})} />
                          </div>
                          <div>
                             <label className={labelClass}>Account Number / IBAN</label>
                             <input type="text" className={inputClass} placeholder="e.g. 0101-0101-0101" value={accountData.account_number || ''} onChange={e => setAccountData({...accountData, account_number: e.target.value})} />
                          </div>
                       </MotionDiv>
                    )}
                    <div>
                       <label className={labelClass}>Opening Balance (Rs)</label>
                       <input type="number" className={inputClass} placeholder="0" value={accountData.balance || ''} onChange={e => setAccountData({...accountData, balance: parseFloat(e.target.value) || 0})} />
                    </div>
                    <button 
                      type="submit" 
                      disabled={isSubmittingAccount}
                      className={`w-full font-bold py-3 rounded-xl shadow-md mt-2 text-xs sm:text-sm cursor-pointer transition-all flex items-center justify-center gap-1.5 ${
                        isSubmittingAccount ? 'bg-slate-400 text-white cursor-not-allowed shadow-none' : 'bg-lime-600 hover:bg-lime-700 text-white'
                      }`}
                    >
                       {isSubmittingAccount ? (
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

        {/* 4. Edit Account Modal */}
        {isEditAccountOpen && editingAccount && (
           <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-4">
              <MotionDiv 
                initial="hidden" animate="visible" exit="hidden" variants={modalOverlay}
                className="absolute inset-0 bg-slate-950/60 backdrop-blur-xs" onClick={() => setIsEditAccountOpen(false)} 
              />
              <MotionDiv 
                initial="hidden" animate="visible" exit="exit" variants={modalContent}
                className="relative bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden max-h-[92vh] flex flex-col"
              >
                 <div className="px-5 py-4 border-b border-indigo-100 flex justify-between items-center bg-indigo-50/60 shrink-0">
                    <h3 className="font-bold text-sm sm:text-base text-indigo-950 flex items-center gap-2">
                       <Edit3 size={16} className="text-indigo-600" /> Edit Account
                    </h3>
                    <button aria-label="Band karein" onClick={() => setIsEditAccountOpen(false)} className="bg-white p-1.5 rounded-full hover:bg-slate-100 text-slate-500 hover:text-slate-800 transition-colors cursor-pointer"><X size={15}/></button>
                 </div>
                 <form onSubmit={handleEditAccountSubmit} className="p-4 sm:p-5 space-y-3.5 overflow-y-auto flex-1">
                    <div>
                       <label className={labelClass}>Account Name</label>
                       <input 
                         type="text" 
                         className={inputClass} 
                         required 
                         value={editAccountFormData.name || ''} 
                         onChange={e => setEditAccountFormData({...editAccountFormData, name: e.target.value})} 
                         autoFocus 
                       />
                    </div>

                    <div>
                       <label className={labelClass}>Account Type</label>
                       <div className="grid grid-cols-3 gap-2">
                          {(['Cash', 'Bank', 'Wallet'] as const).map(t => (
                             <button
                                key={t} type="button"
                                onClick={() => setEditAccountFormData({...editAccountFormData, type: t, isDrawer: t === 'Cash' ? editAccountFormData.isDrawer : undefined})}
                                className={`py-2 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${editAccountFormData.type === t ? 'bg-lime-600 text-white border-lime-600 shadow-xs' : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'}`}
                             >
                                {t}
                             </button>
                          ))}
                       </div>
                    </div>

                    {editAccountFormData.type === 'Cash' && (
                       <label className="flex items-center justify-between gap-3 p-3 bg-slate-50 border border-slate-200 rounded-2xl cursor-pointer">
                          <div>
                             <p className="text-xs font-bold text-slate-700">Cash Drawer ke tor par enable</p>
                             <p className="text-[10px] text-slate-400 font-medium">Sirf enabled Cash accounts hi POS shifts / Cash Control men drawer bante hain</p>
                          </div>
                          <input
                            type="checkbox"
                            className="w-4 h-4 accent-lime-600 shrink-0"
                            checked={editAccountFormData.isDrawer === true}
                            onChange={e => setEditAccountFormData({...editAccountFormData, isDrawer: e.target.checked})}
                          />
                       </label>
                    )}

                    {editAccountFormData.type === 'Bank' && (
                       <div className="space-y-3 animate-in fade-in">
                          <div>
                             <label className={labelClass}>Bank Name</label>
                             <input 
                               type="text" 
                               className={inputClass} 
                               placeholder="e.g. Meezan Bank" 
                               value={editAccountFormData.bank_name || ''} 
                               onChange={e => setEditAccountFormData({...editAccountFormData, bank_name: e.target.value})} 
                             />
                          </div>
                          <div>
                             <label className={labelClass}>Account Number / IBAN</label>
                             <input 
                               type="text" 
                               className={inputClass} 
                               placeholder="e.g. PK..." 
                               value={editAccountFormData.account_number || ''} 
                               onChange={e => setEditAccountFormData({...editAccountFormData, account_number: e.target.value})} 
                             />
                          </div>
                       </div>
                    )}

                    <div className="flex items-center justify-between p-3 bg-slate-50 border border-slate-200 rounded-2xl">
                       <div>
                          <p className="text-xs font-bold text-slate-700">Account Status</p>
                          <p className="text-[10px] text-slate-400 font-medium">Inactive accounts are hidden from selectors</p>
                       </div>
                       <label className="relative inline-flex items-center cursor-pointer">
                          <input 
                            type="checkbox" 
                            className="sr-only peer" 
                            checked={editAccountFormData.isActive !== false} 
                            onChange={e => setEditAccountFormData({...editAccountFormData, isActive: e.target.checked})} 
                          />
                          <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-600"></div>
                       </label>
                    </div>

                    <div className="p-3 bg-indigo-50/50 border border-indigo-100 rounded-2xl flex items-center justify-between text-xs">
                       <span className="text-indigo-900 font-medium">Current Balance:</span>
                       <span className="font-bold text-slate-900 font-mono">{formatCurrency(editingAccount.balance)}</span>
                    </div>

                    <button 
                      type="submit" 
                      disabled={isSubmittingAccount}
                      className={`w-full font-bold py-3 rounded-xl shadow-md mt-2 text-xs sm:text-sm transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                        isSubmittingAccount ? 'bg-slate-400 text-white cursor-not-allowed shadow-none' : 'bg-indigo-600 hover:bg-indigo-700 text-white'
                      }`}
                    >
                       {isSubmittingAccount ? (
                         <>
                           <Loader2 size={16} className="animate-spin" /> Saving...
                         </>
                       ) : (
                         'Save Changes'
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

export default BankCash;
