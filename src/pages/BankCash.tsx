import React, { Suspense, lazy, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowDownLeft, ArrowRightLeft, ArrowUpRight, Building2, Clock3, History, Landmark, Pencil, Plus, RotateCcw, Trash2, Wallet,
} from 'lucide-react';
import { useDairy } from '../context/DairyContext';
import { useToast } from '../context/ToastContext';
import type { FinancialAccount } from '../types';
import { formatCurrency } from '../lib/formatters';
import { useMediaQuery, BREAKPOINTS } from '../hooks/useMediaQuery';
import { useReducedMotion } from '../hooks/useReducedMotion';
import {
  Badge, Button, Card, CardHeader, EmptyState, IconButton, Money, PageHeader, SearchInput, SegmentedControl, StatCard, Toolbar, confirmAction,
} from '../components/ui';
import { AccountCard, AccountCardSkeleton, AllAccountsCard } from '../components/finance/AccountCard';
import { PeriodFilter } from '../components/finance/PeriodFilter';
import { StatMoney } from '../components/finance/StatMoney';
import { StatementSummary, StatementView, type SummaryItem } from '../components/finance/StatementView';
import {
  ACCOUNT_ICON, type Flow, type PeriodPreset, buildLedgerEntries, buildStatement, countByAccount, formatDay, inRange, isDefaultAccount,
  matchesFlow, periodRange, summarizePeriod, todayPk,
} from '../components/finance/ledger';
import type { CashEntryMode } from '../components/finance/CashEntryDialog';

// Dialogs load on first open, so they stay out of the screen's first chunk.
const TransferDialog = lazy(() => import('../components/finance/TransferDialog'));
const CashEntryDialog = lazy(() => import('../components/finance/CashEntryDialog'));
const AccountFormDialog = lazy(() => import('../components/finance/AccountFormDialog'));

type DialogState =
  | { kind: 'transfer' }
  | { kind: 'entry'; mode: CashEntryMode }
  | { kind: 'account'; account: FinancialAccount | null };

type TypeFilter = 'All' | FinancialAccount['type'];

const STRIP_ITEM = 'w-[15.5rem] shrink-0 snap-start sm:w-auto';

const accountFromUrl = (search: string) => new URLSearchParams(search).get('account') || 'all';

const BankCash: React.FC = () => {
  const {
    accounts, bankTransactions, expenses, sales,
    customers, customerTransactions,
    suppliers, supplierTransactions,
    settings, cashInTransit, hasLoadedData,
    getDeleteAssessment, safeDeleteAccount, reactivateEntity,
    canPerform,
  } = useDairy();
  const { showToast } = useToast();
  const canManage = canPerform('bank_cash', 'create');
  const denyIfNoAccess = useCallback(() => {
    if (canManage) return false;
    showToast('Aap ko is kaam ki ijazat nahi hai.', 'warning');
    return true;
  }, [canManage, showToast]);

  const location = useLocation();
  const navigate = useNavigate();
  const isDesktop = useMediaQuery(BREAKPOINTS.md);
  const reducedMotion = useReducedMotion();
  const statementRef = useRef<HTMLElement>(null);

  const [selectedAccountId, setSelectedAccountId] = useState(() => accountFromUrl(window.location.search));
  // The page stays mounted while other screens are open: only follow the URL while it is ours.
  useEffect(() => {
    if (location.pathname.startsWith('/bank-cash')) setSelectedAccountId(accountFromUrl(location.search));
  }, [location.pathname, location.search]);

  const selectAccount = useCallback((id: string) => {
    setSelectedAccountId(id);
    navigate(id !== 'all' ? `/bank-cash?account=${encodeURIComponent(id)}` : '/bank-cash');
    // On phones the statement sits below the cards: bring it into view.
    if (!isDesktop) {
      window.requestAnimationFrame(() => statementRef.current?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' }));
    }
  }, [navigate, isDesktop, reducedMotion]);

  const [typeFilter, setTypeFilter] = useState<TypeFilter>('All');
  const [accountSearch, setAccountSearch] = useState('');
  const [ledgerSearch, setLedgerSearch] = useState('');
  const [flow, setFlow] = useState<Flow>('All');
  const [period, setPeriod] = useState<PeriodPreset>('all');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [busyAccountId, setBusyAccountId] = useState<string | null>(null);
  const deferredSearch = useDeferredValue(ledgerSearch);

  // A stale or deleted ?account= falls back to the consolidated view.
  const selectedAccount = selectedAccountId === 'all' ? undefined : accounts.find(a => a.id === selectedAccountId);
  const viewId = selectedAccount ? selectedAccount.id : 'all';

  const ledger = useMemo(() => buildLedgerEntries({
    accounts, bankTransactions, expenses, sales, customers, customerTransactions, suppliers, supplierTransactions, settings,
  }), [accounts, bankTransactions, expenses, sales, customers, customerTransactions, suppliers, supplierTransactions, settings]);

  const entryCounts = useMemo(() => countByAccount(ledger), [ledger]);

  const totals = useMemo(() => {
    let total = 0;
    let cash = 0;
    let digital = 0;
    let cashCount = 0;
    let activeCount = 0;
    for (const account of accounts) {
      const balance = Number(account.balance) || 0;
      total += balance;
      if (account.type === 'Cash') { cash += balance; cashCount += 1; }
      else digital += balance;
      if (account.isActive !== false) activeCount += 1;
    }
    return { total, cash, digital, cashCount, digitalCount: accounts.length - cashCount, activeCount };
  }, [accounts]);

  const typeCounts = useMemo(() => {
    const counts: Record<TypeFilter, number> = { All: accounts.length, Cash: 0, Bank: 0, Wallet: 0 };
    for (const account of accounts) counts[account.type] = (counts[account.type] || 0) + 1;
    return counts;
  }, [accounts]);

  const visibleAccounts = useMemo(() => {
    const query = accountSearch.trim().toLowerCase();
    const list = accounts.filter(acc => {
      if (typeFilter !== 'All' && acc.type !== typeFilter) return false;
      if (!query) return true;
      return acc.name.toLowerCase().includes(query)
        || (acc.bank_name || '').toLowerCase().includes(query)
        || (acc.account_number || '').toLowerCase().includes(query);
    });
    // Active accounts first; otherwise keep the saved order.
    return list.filter(a => a.isActive !== false).concat(list.filter(a => a.isActive === false));
  }, [accounts, typeFilter, accountSearch]);

  // Statement for the selected account: its full history, so the running balance is right whatever the filters.
  const accountEntries = useMemo(
    () => (viewId === 'all' ? ledger : ledger.filter(entry => entry.accountId === viewId)),
    [ledger, viewId],
  );
  const statement = useMemo(
    () => (selectedAccount ? buildStatement(accountEntries, selectedAccount.balance) : null),
    [accountEntries, selectedAccount],
  );

  const today = todayPk();
  const range = useMemo(() => periodRange(period, customFrom, customTo, today), [period, customFrom, customTo, today]);
  const summary = useMemo(
    () => summarizePeriod(accountEntries, range, statement?.opening ?? 0, !statement),
    [accountEntries, range, statement],
  );

  const { rows, flowCounts } = useMemo(() => {
    const query = deferredSearch.trim().toLowerCase();
    const counts: Record<Flow, number> = { All: 0, Inflow: 0, Outflow: 0, Transfer: 0 };
    const list = accountEntries.filter(entry => {
      if (!inRange(entry.day, range)) return false;
      if (query && !(
        entry.description.toLowerCase().includes(query) ||
        entry.category.toLowerCase().includes(query) ||
        entry.accountName.toLowerCase().includes(query) ||
        String(entry.amount).includes(query)
      )) return false;
      counts.All += 1;
      if (matchesFlow(entry, 'Inflow')) counts.Inflow += 1; else counts.Outflow += 1;
      if (matchesFlow(entry, 'Transfer')) counts.Transfer += 1;
      return matchesFlow(entry, flow);
    });
    return { rows: list, flowCounts: counts };
  }, [accountEntries, range, deferredSearch, flow]);

  const isFiltered = Boolean(deferredSearch.trim()) || flow !== 'All';
  const periodLabel = range.from || range.to
    ? `${range.from ? formatDay(range.from) : 'Shuru'} – ${range.to ? formatDay(range.to) : 'Aaj'}`
    : 'All time';

  const summaryItems: SummaryItem[] = statement
    ? [
        { label: 'Opening (b/f)', amount: summary.opening, tone: 'balance', hint: range.from ? formatDay(range.from) : 'Pehli entry se pehle' },
        { label: 'Money in', amount: summary.inflow, tone: 'in', prefix: '+ ' },
        { label: 'Money out', amount: summary.outflow, tone: 'out', prefix: '− ' },
        { label: 'Closing (c/f)', amount: summary.closing, tone: 'balance', hint: range.to && range.to < today ? formatDay(range.to) : 'Current balance' },
      ]
    : [
        { label: 'Money in', amount: summary.inflow, tone: 'in', prefix: '+ ', hint: 'Transfers ke baghair' },
        { label: 'Money out', amount: summary.outflow, tone: 'out', prefix: '− ', hint: 'Transfers ke baghair' },
        { label: 'Net flow', amount: summary.inflow - summary.outflow, tone: 'balance' },
        { label: 'Entries', amount: 0, text: summary.count.toLocaleString('en-PK'), hint: periodLabel },
      ];

  const openDialog = (next: DialogState) => {
    if (denyIfNoAccess()) return;
    setDialog(next);
  };
  const closeDialog = useCallback(() => setDialog(null), []);

  const handleReactivate = async (acc: FinancialAccount) => {
    if (denyIfNoAccess() || busyAccountId) return;
    setBusyAccountId(acc.id);
    try {
      // reactivateEntity shows its own result toast.
      await reactivateEntity('account', acc.id);
    } finally {
      setBusyAccountId(null);
    }
  };

  const handleDeleteAccount = async (acc: FinancialAccount) => {
    if (denyIfNoAccess() || busyAccountId) return;
    const assessment = getDeleteAssessment('account', acc.id);

    if (assessment.details?.isSystem) {
      showToast(`"${acc.name}" default account hai, is liye delete ya Inactive nahi ho sakta. Pehle Settings mein doosra default chunein.`, 'warning');
      return;
    }
    if (assessment.balance !== 0) {
      showToast(`"${acc.name}" delete nahi ho sakta: is mein abhi ${formatCurrency(acc.balance)} balance hai. Pehle sari raqam doosre account mein transfer karein.`, 'error');
      return;
    }

    if (assessment.hasHistory) {
      if (acc.isActive === false) {
        showToast(`"${acc.name}" pehle se Inactive hai. Is ki entries ki wajah se yeh delete nahi ho sakta.`, 'info');
        return;
      }
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
      if (!deactivate) return;
      setBusyAccountId(acc.id);
      try {
        // safeDeleteAccount shows its own result toast.
        await safeDeleteAccount(acc.id, 'deactivate');
      } finally {
        setBusyAccountId(null);
      }
      return;
    }

    const hardDelete = await confirmAction({
      title: `"${acc.name}" delete karein?`,
      message: 'Is account mein koi transaction nahi, is liye yeh hamesha ke liye hat jayega.',
      consequences: ['Yeh kaam wapas nahi ho sakta.'],
    });
    if (!hardDelete) return;
    setBusyAccountId(acc.id);
    try {
      const deleted = await safeDeleteAccount(acc.id, 'hard_delete');
      if (deleted && selectedAccountId === acc.id) selectAccount('all');
    } finally {
      setBusyAccountId(null);
    }
  };

  const loading = !hasLoadedData;
  const hasActiveAccounts = totals.activeCount > 0;
  const showAccountSearch = accounts.length > 6;
  const SelectedIcon = selectedAccount ? ACCOUNT_ICON[selectedAccount.type] || Landmark : Landmark;
  const inTransit = cashInTransit?.amount || 0;
  const transitCount = cashInTransit?.count || 0;

  const emptyStatement = accounts.length === 0 ? (
    <EmptyState
      icon={<Wallet />}
      title="Abhi koi account nahi"
      description="Cash counter, bank ya mobile wallet ka account banayein, phir yahan us ki entries nazar aayengi."
      action={canManage ? <Button leftIcon={<Plus />} onClick={() => openDialog({ kind: 'account', account: null })}>Add account</Button> : undefined}
    />
  ) : (
    <EmptyState
      size="compact"
      icon={<History />}
      title={isFiltered || range.from || range.to ? 'Is filter mein koi entry nahi' : 'Abhi koi entry nahi'}
      description={isFiltered || range.from || range.to ? 'Search, type ya tareekh badal kar dekhein.' : 'Deposit, withdrawal ya transfer record karein.'}
    />
  );

  return (
    <div className="flex flex-col gap-6 pb-4">
      <PageHeader
        eyebrow="Finance"
        description="Cash, bank aur wallet accounts: balances, transfers, deposits aur har account ka statement."
        actions={canManage ? (
          <>
            <Button variant="secondary" leftIcon={<ArrowDownLeft />} disabled={!hasActiveAccounts} onClick={() => openDialog({ kind: 'entry', mode: 'Deposit' })}>
              Deposit
            </Button>
            <Button variant="secondary" leftIcon={<ArrowUpRight />} disabled={!hasActiveAccounts} onClick={() => openDialog({ kind: 'entry', mode: 'Withdrawal' })}>
              Withdraw
            </Button>
            <Button leftIcon={<ArrowRightLeft />} disabled={totals.activeCount < 2} onClick={() => openDialog({ kind: 'transfer' })}>
              Transfer
            </Button>
          </>
        ) : undefined}
      />

      <section aria-label="Totals" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Total balance"
          icon={<Landmark />}
          tone="brand"
          loading={loading}
          value={<StatMoney amount={totals.total} negativeRed />}
          hint={loading ? undefined : `${totals.activeCount} active accounts`}
        />
        <StatCard
          label="Cash in hand"
          icon={<Wallet />}
          loading={loading}
          value={<StatMoney amount={totals.cash} negativeRed />}
          hint={loading ? undefined : `${totals.cashCount} cash accounts`}
        />
        <StatCard
          label="Bank & wallets"
          icon={<Building2 />}
          loading={loading}
          value={<StatMoney amount={totals.digital} negativeRed />}
          hint={loading ? undefined : `${totals.digitalCount} accounts`}
        />
        <StatCard
          label="Cash in transit"
          icon={<Clock3 />}
          tone={inTransit > 0 ? 'warning' : 'neutral'}
          loading={loading}
          value={<StatMoney amount={inTransit} />}
          hint={loading ? undefined : transitCount > 0 ? `${transitCount} remittance${transitCount > 1 ? 's' : ''} pending` : 'Kuch pending nahi'}
        />
      </section>

      {!loading && inTransit > 0 && (
        <p className="-mt-3 flex items-start gap-2 rounded-card border border-warning/25 bg-warning-soft px-4 py-3 text-[13px] leading-relaxed text-warning-fg">
          <Clock3 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            <strong className="font-semibold"><Money amount={inTransit} /> cash in transit</strong>: shift close par drawer se nikal chuki, kisi account mein nahi.
            Head receive karte hi yahan ke accounts mein aayegi. Total cash = accounts + in-transit.
          </span>
        </p>
      )}

      <section aria-labelledby="bank-accounts-heading" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 id="bank-accounts-heading" className="mr-auto text-[15px] font-bold tracking-tight text-fg">Accounts</h3>
          {showAccountSearch && (
            <SearchInput value={accountSearch} onChange={setAccountSearch} placeholder="Account, bank, number..." className="w-full sm:w-60" />
          )}
          <SegmentedControl
            aria-label="Account type"
            size="sm"
            value={typeFilter}
            onChange={setTypeFilter}
            options={(['All', 'Cash', 'Bank', 'Wallet'] as const).map(type => ({ value: type, label: type, count: typeCounts[type] }))}
          />
          {canManage && (
            <Button variant="secondary" size="sm" leftIcon={<Plus />} onClick={() => openDialog({ kind: 'account', account: null })}>
              Add account
            </Button>
          )}
        </div>

        {/* Phones: a swipeable strip, so the statement stays near the top. Wider screens: a grid. */}
        <div className="-mx-3 flex snap-x snap-mandatory gap-3 -my-1 overflow-x-auto px-3 py-1 scrollbar-hide sm:mx-0 sm:my-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 sm:py-0 lg:grid-cols-3 2xl:grid-cols-4">
          {loading ? (
            Array.from({ length: 4 }, (_, i) => <React.Fragment key={i}><AccountCardSkeleton className={STRIP_ITEM} /></React.Fragment>)
          ) : (
            <>
              {typeFilter === 'All' && !accountSearch.trim() && accounts.length > 0 && (
                <AllAccountsCard total={totals.total} accountCount={accounts.length} selected={viewId === 'all'} onSelect={selectAccount} className={STRIP_ITEM} />
              )}
              {visibleAccounts.map(acc => (
                <AccountCard
                  key={acc.id}
                  account={acc}
                  entryCount={entryCounts.get(acc.id) || 0}
                  selected={viewId === acc.id}
                  isDefault={isDefaultAccount(acc, settings)}
                  onSelect={selectAccount}
                  className={STRIP_ITEM}
                />
              ))}
            </>
          )}
        </div>
        {!loading && accounts.length > 0 && visibleAccounts.length === 0 && (
          <p className="rounded-card border border-dashed border-line px-4 py-6 text-center text-sm text-fg-subtle">Is filter mein koi account nahi.</p>
        )}
      </section>

      <section ref={statementRef} aria-label="Account statement" className="flex scroll-mt-4 flex-col gap-3">
        <Card>
          <CardHeader
            icon={<SelectedIcon />}
            eyebrow="Statement"
            title={selectedAccount ? selectedAccount.name : 'All accounts'}
            description={selectedAccount
              ? [selectedAccount.type, selectedAccount.bank_name, selectedAccount.account_number].filter(Boolean).join(' · ')
              : 'Har account ki entries ek jagah. Running balance ke liye account chunein.'}
            actions={canManage && selectedAccount ? (
              <>
                {selectedAccount.isActive === false && (
                  <Button
                    variant="soft"
                    size="sm"
                    leftIcon={<RotateCcw />}
                    loading={busyAccountId === selectedAccount.id}
                    onClick={() => handleReactivate(selectedAccount)}
                  >
                    Reactivate
                  </Button>
                )}
                <IconButton
                  aria-label="Account edit karein"
                  icon={<Pencil />}
                  size="sm"
                  variant="secondary"
                  onClick={() => openDialog({ kind: 'account', account: selectedAccount })}
                />
                <IconButton
                  aria-label="Account delete / Inactive karein"
                  icon={<Trash2 />}
                  size="sm"
                  variant="danger-soft"
                  disabled={busyAccountId === selectedAccount.id}
                  onClick={() => handleDeleteAccount(selectedAccount)}
                />
              </>
            ) : undefined}
          />
          <div className="flex flex-col gap-3 px-5 pb-5">
            {selectedAccount && (selectedAccount.isActive === false || isDefaultAccount(selectedAccount, settings)) && (
              <div className="flex flex-wrap gap-1.5">
                {isDefaultAccount(selectedAccount, settings) && <Badge tone="brand">Default account</Badge>}
                {selectedAccount.isActive === false && <Badge tone="neutral" dot>Inactive</Badge>}
              </div>
            )}
            <StatementSummary items={summaryItems} loading={loading} />
          </div>
        </Card>

        <Toolbar>
          <SearchInput
            value={ledgerSearch}
            onChange={setLedgerSearch}
            placeholder="Entry, party, bill # ya amount..."
            className="w-full sm:w-64"
          />
          <SegmentedControl
            aria-label="Money direction"
            size="sm"
            value={flow}
            onChange={setFlow}
            options={[
              { value: 'All', label: 'All', count: flowCounts.All },
              { value: 'Inflow', label: 'In', count: flowCounts.Inflow },
              { value: 'Outflow', label: 'Out', count: flowCounts.Outflow },
              { value: 'Transfer', label: 'Transfers', count: flowCounts.Transfer },
            ]}
          />
          <div className="sm:ml-auto">
            <PeriodFilter
              preset={period}
              onPresetChange={setPeriod}
              from={customFrom}
              to={customTo}
              onFromChange={setCustomFrom}
              onToChange={setCustomTo}
              maxDate={today}
            />
          </div>
        </Toolbar>

        <StatementView
          entries={rows}
          balanceAfter={statement ? statement.balanceAfter : null}
          showAccount={!selectedAccount}
          openingBalance={statement && !isFiltered ? summary.opening : null}
          resetKey={`${viewId}|${flow}|${period}|${range.from}|${range.to}|${deferredSearch}`}
          empty={emptyStatement}
          loading={loading}
        />
      </section>

      <Suspense fallback={null}>
        {dialog?.kind === 'transfer' && <TransferDialog onClose={closeDialog} defaultFromId={selectedAccount?.id} />}
        {dialog?.kind === 'entry' && <CashEntryDialog mode={dialog.mode} onClose={closeDialog} defaultAccountId={selectedAccount?.id} />}
        {dialog?.kind === 'account' && <AccountFormDialog account={dialog.account} onClose={closeDialog} />}
      </Suspense>
    </div>
  );
};

export default BankCash;
