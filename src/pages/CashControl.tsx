import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowRight, CalendarDays, History, RefreshCw, Settings2, Store, WalletCards } from 'lucide-react';
import { Button, Card, EmptyState, PageHeader, SegmentedControl } from '../components/ui';
import { useDairy } from '../context/DairyContext';
import HeadInbox from '../components/cash/HeadInbox';
import BusinessDays from '../components/cash/BusinessDays';
import AuditTrail from '../components/cash/AuditTrail';
import DrawersPanel from '../components/cash/DrawersPanel';
import { formatBusinessDate } from '../components/cash/cashFormat';
import { useCashAction } from '../components/cash/useCashData';
import { isCashTab, type CashTab } from '../components/cash/tabs';

/**
 * Cash Control (head only): receive remittances, settle handovers, close and lock business days,
 * review variances and load drawers. Cashier shifts start and close on the POS counter.
 * Workflow: docs/cash-control.md.
 */
const CashControl: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    currentUser, currentRole, cashRemittances, cashVariances, businessDays, getBusinessDate, isDayLocked, refreshCashControl,
  } = useDairy();
  const { run, busyKey } = useCashAction();

  // A ?tab= link selects the tab; without one the page keeps its tab (it stays mounted while hidden).
  const [tab, setTab] = useState<CashTab>(() => {
    const param = new URLSearchParams(location.search).get('tab');
    return isCashTab(param) ? param : 'head';
  });
  useEffect(() => {
    const param = new URLSearchParams(location.search).get('tab');
    if (isCashTab(param)) setTab(param);
  }, [location.search]);
  const selectTab = useCallback((next: CashTab) => {
    setTab(next);
    navigate(`/cash-control?tab=${next}`);
  }, [navigate]);

  const permissions = [...(currentRole?.permissions || []), ...(currentUser?.permissions || [])].map(String);
  const isOwner = currentUser?.role_id === 'role_super_admin';
  const isHead = isOwner || currentUser?.role_id === 'role_manager' || permissions.includes('cash_control:approve') || permissions.includes('cash_control');
  const today = getBusinessDate();
  const todayLocked = Boolean(isDayLocked?.(today));

  const pendingRemits = useMemo(() => cashRemittances.filter(remittance => remittance.status === 'Pending').length, [cashRemittances]);
  const openVariances = useMemo(() => cashVariances.filter(variance => variance.status === 'Open').length, [cashVariances]);
  const openDays = useMemo(() => businessDays.filter(day => day.status !== 'Closed').length, [businessDays]);

  if (!isHead) {
    return (
      <Card className="mx-auto mt-10 max-w-lg">
        <EmptyState
          icon={<Store />}
          title="Cashier shifts POS counter par hain"
          description="Shift POS ke andar hi start aur close hoti hai. Cash Control head ke liye hai: remittance receive karna, din close karna aur audit."
          action={<Button rightIcon={<ArrowRight />} onClick={() => navigate('/pos')}>Go to POS counter</Button>}
        />
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4 pb-10 sm:gap-6">
      <PageHeader
        eyebrow="Cash control"
        description="Cashiers ka cash receive karein, din close karein aur har farq ka hisaab rakhein."
        actions={(
          <Button
            variant="secondary"
            leftIcon={<RefreshCw />}
            loading={busyKey === 'refresh'}
            disabled={busyKey !== null && busyKey !== 'refresh'}
            onClick={() => run('refresh', async () => { await refreshCashControl(); return true; })}
          >
            Refresh
          </Button>
        )}
      >
        <SegmentedControl
          aria-label="Cash control sections"
          variant="underline"
          value={tab}
          onChange={selectTab}
          options={[
            { value: 'head', label: 'Head Inbox', icon: <WalletCards />, count: pendingRemits || undefined },
            { value: 'days', label: 'Business Days', icon: <CalendarDays />, count: openDays || undefined },
            { value: 'audit', label: 'Audit Trail', icon: <History />, count: openVariances || undefined },
            { value: 'drawers', label: 'Drawers', icon: <Settings2 /> },
          ]}
        />
      </PageHeader>

      {todayLocked && (
        <div role="status" className="flex items-start gap-3 rounded-card bg-warning-soft px-4 py-3 text-[13px] text-warning-fg ring-1 ring-inset ring-warning/25">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p>
            <span className="font-bold">Business day locked:</span> {formatBusinessDate(today)} lock hai. Is tareekh ki entries, drawer loads aur closing tabdeel nahi ho sakti.
          </p>
        </div>
      )}

      <div key={tab} className="animate-fade-up">
        {tab === 'head' && <HeadInbox run={run} busyKey={busyKey} onOpenTab={selectTab} />}
        {tab === 'days' && <BusinessDays run={run} busyKey={busyKey} canReopen={isOwner} onOpenTab={selectTab} />}
        {tab === 'audit' && <AuditTrail run={run} busyKey={busyKey} />}
        {tab === 'drawers' && <DrawersPanel run={run} busyKey={busyKey} todayLocked={todayLocked} onManage={() => navigate('/bank-cash')} />}
      </div>
    </div>
  );
};

export default CashControl;
