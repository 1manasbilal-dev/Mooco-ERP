import React, { Suspense, lazy, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  BookOpen, ChevronsDownUp, ChevronsUpDown, Landmark, PieChart, Plus, Scale, TrendingUp, Wallet,
} from 'lucide-react';
import { useDairy } from '../context/DairyContext';
import { useToast } from '../context/ToastContext';
import {
  Button, Card, CardBody, EmptyState, Money, PageHeader, SearchInput, SegmentedControl, SkeletonText, StatCard, StatGrid, Toolbar,
  confirmAction,
} from '../components/ui';
import { CoaTable } from '../components/finance/CoaTable';
import { StatMoney } from '../components/finance/StatMoney';
import {
  type AccountType, type COANode, buildChartOfAccounts, filterChart, flattenChart, groupIds, referencedLedgerIds,
} from '../components/finance/coa';
import type { ParentOption } from '../components/finance/LedgerAccountDialog';

// Loaded on first use, so the chart's first paint does not wait for them.
const LedgerAccountDialog = lazy(() => import('../components/finance/LedgerAccountDialog'));
const JournalPanel = lazy(() => import('../components/finance/JournalPanel'));

type Tab = 'chart' | 'journal';
type TypeFilter = AccountType | 'All';

const ROOT_GROUPS: Record<string, boolean> = { '1000': true, '2000': true, '3000': true, '4000': true, '5000': true };

const TYPE_OPTIONS: { value: TypeFilter; label: string }[] = [
  { value: 'All', label: 'All' },
  { value: 'Asset', label: 'Assets' },
  { value: 'Liability', label: 'Liabilities' },
  { value: 'Equity', label: 'Equity' },
  { value: 'Income', label: 'Income' },
  { value: 'Expense', label: 'Expenses' },
];

const tabFromUrl = (search: string): Tab => (new URLSearchParams(search).get('tab') === 'journal' ? 'journal' : 'chart');

const Accounts: React.FC = () => {
  const {
    accounts, inventory, items, customers, suppliers,
    purchases, materialPurchases, sales, dailySupplyEntries, expenses, expenseVendors,
    bankTransactions, manualAccounts, deleteManualAccount, updateManualAccount,
    journalEntries, hasLoadedData,
    canPerform,
  } = useDairy();
  const { showToast } = useToast();
  const canCreate = canPerform('accounts', 'create');

  const location = useLocation();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState<Tab>(() => tabFromUrl(window.location.search));
  // The page stays mounted while other screens are open: only follow the URL while it is ours.
  useEffect(() => {
    if (!location.pathname.startsWith('/accounts')) return;
    const tab = new URLSearchParams(location.search).get('tab');
    if (tab === 'chart' || tab === 'journal') setActiveTab(tab);
  }, [location.pathname, location.search]);

  const selectTab = (tab: Tab) => {
    setActiveTab(tab);
    navigate(`/accounts?tab=${tab}`);
  };

  const [expanded, setExpanded] = useState<Record<string, boolean>>(ROOT_GROUPS);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('All');
  const [dialog, setDialog] = useState<{ parentId: string; type: AccountType } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const deferredSearch = useDeferredValue(search);

  const chart = useMemo(() => buildChartOfAccounts({
    accounts, inventory, items, customers, suppliers, purchases, materialPurchases, sales, dailySupplyEntries, expenses, expenseVendors,
    bankTransactions, manualAccounts,
  }), [accounts, inventory, items, customers, suppliers, purchases, materialPurchases, sales, dailySupplyEntries, expenses, expenseVendors, bankTransactions, manualAccounts]);

  // Unfiltered lookup: a search result only carries the children that matched, so guards read the real node.
  const nodeById = useMemo(() => {
    const map = new Map<string, COANode>();
    const walk = (nodes: COANode[]) => nodes.forEach(node => { map.set(node.id, node); if (node.children) walk(node.children); });
    walk(chart);
    return map;
  }, [chart]);

  const filtered = useMemo(() => filterChart(chart, deferredSearch, typeFilter), [chart, deferredSearch, typeFilter]);
  // While searching every matching branch is shown open; the saved open/closed state comes back after.
  const rows = useMemo(() => flattenChart(filtered, expanded, Boolean(deferredSearch.trim())), [filtered, expanded, deferredSearch]);
  const referenced = useMemo(() => referencedLedgerIds(journalEntries as any, bankTransactions), [journalEntries, bankTransactions]);

  const totals = useMemo(() => {
    const byId = (id: string) => chart.find(node => node.id === id)?.balance || 0;
    const income = byId('4000');
    const expense = byId('5000');
    return { assets: byId('1000'), liabilities: byId('2000'), equity: byId('3000'), net: income - expense };
  }, [chart]);

  const parentOptions = useMemo(() => {
    const options: ParentOption[] = [];
    const traverse = (nodes: COANode[], depth: number) => {
      nodes.forEach(node => {
        const allowParenting = node.isGroup || !node.isSystem || ['inc_sales_group', 'sys_eq_cap_group', 'sys_eq_draw_group'].includes(node.id);
        if (allowParenting) options.push({ id: node.id, name: node.name, type: node.type, depth });
        if (node.children) traverse(node.children, depth + 1);
      });
    };
    traverse(chart, 0);
    return options;
  }, [chart]);

  const denyIfNoAccess = () => {
    if (canCreate) return false;
    showToast("You don't have permission to do this.", 'warning');
    return true;
  };

  const openAdd = (parentId = '', type: AccountType = 'Liability') => {
    if (denyIfNoAccess()) return;
    setDialog({ parentId, type });
  };

  const setActive = async (node: COANode, active: boolean) => {
    setBusyId(node.id);
    try {
      const ok = await updateManualAccount(node.id, { isActive: active });
      if (ok) showToast(`Account is now ${active ? 'Active' : 'Inactive'}`, 'info');
      else showToast("Account couldn't be updated. Please try again.", 'error');
    } finally {
      setBusyId(null);
    }
  };

  const toggleActive = async (node: COANode) => {
    if (node.isSystem || busyId || denyIfNoAccess()) return;
    await setActive(node, node.isActive === false);
  };

  const handleDelete = async (shown: COANode) => {
    if (busyId || denyIfNoAccess()) return;
    const node = nodeById.get(shown.id) || shown;
    if (node.isSystem) { showToast("A system account can't be deleted.", 'warning'); return; }
    if (node.children && node.children.length > 0) { showToast('This account has sub-accounts under it. Remove them first.', 'error'); return; }
    if (Math.abs(node.balance) > 0) { showToast('The account still has a balance. Make it Inactive instead of deleting it.', 'warning'); return; }

    // Journal lines and deposit / withdrawal entries still point at it: keep it, only hide it.
    if (referenced.has(node.id)) {
      if (node.isActive === false) {
        showToast(`"${node.name}" is already Inactive. It can't be deleted because it has entries.`, 'info');
        return;
      }
      const deactivate = await confirmAction({
        tone: 'warning',
        title: `Make "${node.name}" Inactive?`,
        message: "This account has journal or bank entries recorded, so it won't be deleted but made Inactive.",
        consequences: ['Old entries stay as they are.', 'It will no longer show up for new journal and deposit / withdrawal entries.', 'It can be made Active again later.'],
        confirmLabel: 'Yes, make Inactive',
      });
      if (deactivate) await setActive(node, false);
      return;
    }

    const ok = await confirmAction({
      title: `Delete "${node.name}"?`,
      message: 'This account will be removed from the chart of accounts for good.',
      consequences: ['Its balance is zero and it has no entries, so no ledger is affected.', "This can't be undone."],
    });
    if (!ok) return;
    setBusyId(node.id);
    try {
      const deleted = await deleteManualAccount(node.id);
      if (deleted) showToast('Account deleted', 'success');
      else showToast("Account couldn't be deleted. Please try again.", 'error');
    } finally {
      setBusyId(null);
    }
  };

  // Stable handlers for the memoised rows; they always call the latest version above.
  const latest = useRef({ openAdd, toggleActive, handleDelete });
  latest.current = { openAdd, toggleActive, handleDelete };
  const onToggle = useCallback((id: string) => setExpanded(prev => ({ ...prev, [id]: !prev[id] })), []);
  const onAddSub = useCallback((node: COANode) => latest.current.openAdd(node.id, node.type), []);
  const onToggleActive = useCallback((node: COANode) => { void latest.current.toggleActive(node); }, []);
  const onDelete = useCallback((node: COANode) => { void latest.current.handleDelete(node); }, []);

  const expandAll = () => setExpanded(Object.fromEntries(groupIds(chart).map(id => [id, true])));
  const collapseAll = () => setExpanded({});

  const loading = !hasLoadedData;
  const searching = Boolean(deferredSearch.trim());

  return (
    <div className="flex flex-col gap-6 pb-4">
      <PageHeader
        eyebrow="Finance"
        description="Chart of accounts, ledger balances and double-entry journal vouchers."
        actions={canCreate && activeTab === 'chart' ? (
          <Button leftIcon={<Plus />} onClick={() => openAdd()}>New account</Button>
        ) : undefined}
      >
        <SegmentedControl
          aria-label="Accounts section"
          variant="underline"
          value={activeTab}
          onChange={selectTab}
          options={[
            { value: 'chart', label: 'Chart of Accounts', icon: <PieChart /> },
            { value: 'journal', label: 'Journal Entry', icon: <BookOpen /> },
          ]}
        />
      </PageHeader>

      {activeTab === 'chart' && (
        <>
          <StatGrid
            label="Totals"
            storageKey="accounts"
            peek={loading ? undefined : [
              { value: <Money amount={totals.assets} compact />, label: 'assets' },
              { value: <Money amount={Math.abs(totals.net)} compact />, label: totals.net >= 0 ? 'net income' : 'net loss', tone: totals.net >= 0 ? 'success' : 'danger' },
            ]}
          >
            <StatCard label="Total assets" icon={<Wallet />} loading={loading} value={<StatMoney amount={totals.assets} />} hint="Debit balance" />
            <StatCard label="Liabilities" icon={<Landmark />} loading={loading} value={<StatMoney amount={totals.liabilities} />} hint="Credit balance" />
            <StatCard
              label="Owner's equity"
              icon={<Scale />}
              loading={loading}
              value={<StatMoney amount={totals.equity} negativeRed />}
              hint="Capital − drawings"
            />
            <StatCard
              label={totals.net >= 0 ? 'Net income' : 'Net loss'}
              icon={<TrendingUp />}
              tone={totals.net >= 0 ? 'success' : 'danger'}
              loading={loading}
              value={<StatMoney amount={Math.abs(totals.net)} />}
              hint="Income − expenses, all time"
            />
          </StatGrid>

          <section aria-label="Chart of accounts" className="flex flex-col gap-3">
            <Toolbar>
              <SearchInput value={search} onChange={setSearch} placeholder="Name or code..." className="w-full sm:w-64" />
              <SegmentedControl aria-label="Account type" size="sm" value={typeFilter} onChange={setTypeFilter} options={TYPE_OPTIONS} />
              <div className="flex items-center gap-1 sm:ml-auto">
                <Button variant="ghost" size="sm" leftIcon={<ChevronsUpDown />} onClick={expandAll} disabled={searching}>Expand all</Button>
                <Button variant="ghost" size="sm" leftIcon={<ChevronsDownUp />} onClick={collapseAll} disabled={searching}>Collapse</Button>
              </div>
            </Toolbar>

            <CoaTable
              rows={rows}
              canManage={canCreate}
              busyId={busyId}
              loading={loading}
              onToggle={onToggle}
              onAddSub={onAddSub}
              onToggleActive={onToggleActive}
              onDelete={onDelete}
              empty={
                <EmptyState
                  size="compact"
                  icon={<Landmark />}
                  title="No account found"
                  description="Search with a different name or code, or clear the type filter."
                />
              }
            />
            <p className="px-1 text-xs text-fg-subtle">
              Dr = debit balance, Cr = credit balance. The app builds the locked system accounts itself from its records (Bank & Cash, ledgers, stock, sales, expenses).
            </p>
          </section>
        </>
      )}

      {activeTab === 'journal' && (
        <Suspense
          fallback={
            <Card>
              <CardBody className="pt-5"><SkeletonText lines={6} /></CardBody>
            </Card>
          }
        >
          <JournalPanel />
        </Suspense>
      )}

      <Suspense fallback={null}>
        {dialog && (
          <LedgerAccountDialog
            initialParentId={dialog.parentId}
            initialType={dialog.type}
            parentOptions={parentOptions}
            onClose={() => setDialog(null)}
          />
        )}
      </Suspense>
    </div>
  );
};

export default Accounts;
