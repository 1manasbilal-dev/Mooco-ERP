import React, { Suspense, lazy, memo, useCallback, useMemo, useState } from 'react';
import { ArrowRightLeft, ExternalLink, Plus, Store, Wallet } from 'lucide-react';
import { Badge, Button, Card, EmptyState, Money, StatCard } from '../ui';
import { useDairy } from '../../context/DairyContext';
import type { FinancialAccount, ShiftSession } from '../../types';
import { roundCurrency } from '../../lib/db';
import { LIVE_SHIFT_STATUSES, formatPkTime } from './cashFormat';
import type { RunAction } from './useCashData';

const AddOpeningCashDialog = lazy(() => import('./AddOpeningCashDialog'));

interface DrawersPanelProps {
  run: RunAction;
  busyKey: string | null;
  /** Today's business day is locked: no drawer loads. */
  todayLocked: boolean;
  onManage: () => void;
}

interface DrawerInfo {
  account: FinancialAccount;
  pendingHandover: number;
  liveShift?: ShiftSession;
}

const DrawersPanel: React.FC<DrawersPanelProps> = ({ run, busyKey, todayLocked, onManage }) => {
  const { accounts, cashDrawers, cashHandovers, shiftSessions } = useDairy();
  const [loadingDrawerId, setLoadingDrawerId] = useState<string | null>(null);

  // Only Cash accounts enabled as drawers in Bank & Cash; never Bank or Wallet.
  const drawers = useMemo<DrawerInfo[]>(() => {
    const drawerIdsByAccount = new Map<string, Set<string>>();
    for (const drawer of cashDrawers) {
      if (!drawer.account_id) continue;
      const ids = drawerIdsByAccount.get(drawer.account_id) || new Set<string>();
      ids.add(drawer.id);
      drawerIdsByAccount.set(drawer.account_id, ids);
    }
    return accounts
      .filter(account => account.type === 'Cash' && account.isDrawer === true && account.isActive !== false)
      .map(account => {
        const ids = drawerIdsByAccount.get(account.id) || new Set<string>();
        ids.add(account.id);
        return {
          account,
          pendingHandover: roundCurrency(cashHandovers
            .filter(handover => handover.status === 'Pending' && ids.has(handover.drawer_id))
            .reduce((sum, handover) => sum + Number(handover.declared_amount || 0), 0)),
          liveShift: shiftSessions.find(shift => LIVE_SHIFT_STATUSES.includes(shift.status) && ids.has(String(shift.drawer_id || shift.account_id))),
        };
      });
  }, [accounts, cashDrawers, cashHandovers, shiftSessions]);

  const total = useMemo(() => roundCurrency(drawers.reduce((sum, item) => sum + Number(item.account.balance || 0), 0)), [drawers]);
  const inUse = drawers.filter(item => item.liveShift).length;
  const openLoad = useCallback((accountId: string) => setLoadingDrawerId(accountId), []);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 className="text-[15px] font-bold text-fg">Cash drawers</h3>
          <p className="mt-0.5 max-w-2xl text-[13px] text-fg-subtle">
            Drawers are only the Cash accounts enabled as a &quot;Cash Drawer&quot; in Bank &amp; Cash. Bank/Wallet accounts never become drawers.
          </p>
        </div>
        <Button variant="secondary" leftIcon={<ExternalLink />} onClick={onManage}>Manage in Bank & Cash</Button>
      </div>

      {drawers.length > 0 && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Cash in drawers" icon={<Wallet />} tone="brand" value={<Money amount={total} compact />} hint={`${drawers.length} drawer${drawers.length === 1 ? '' : 's'}`} />
          <StatCard label="In use" icon={<Store />} tone={inUse > 0 ? 'success' : 'neutral'} value={inUse} hint="Live shifts" />
        </div>
      )}

      {drawers.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Store />}
            title="No drawers"
            description="In Bank & Cash, enable a Cash account as a Cash Drawer — it will show here as a drawer."
            action={<Button leftIcon={<ExternalLink />} onClick={onManage}>Open Bank & Cash</Button>}
          />
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {drawers.map(item => (
            <DrawerCard
              key={item.account.id}
              {...item}
              busy={busyKey === `opening:${item.account.id}`}
              disabled={todayLocked || (busyKey !== null && busyKey !== `opening:${item.account.id}`)}
              onLoad={openLoad}
              onLedger={onManage}
            />
          ))}
        </div>
      )}
      {todayLocked && drawers.length > 0 && (
        <p className="text-xs text-fg-subtle">Today's business day is locked — opening cash can't be added to a drawer.</p>
      )}

      {loadingDrawerId && (
        <Suspense fallback={null}>
          <AddOpeningCashDialog drawerAccountId={loadingDrawerId} onClose={() => setLoadingDrawerId(null)} run={run} busyKey={busyKey} />
        </Suspense>
      )}
    </div>
  );
};

const DrawerCard = memo(function DrawerCard({ account, pendingHandover, liveShift, busy, disabled, onLoad, onLedger }: DrawerInfo & {
  busy: boolean;
  disabled: boolean;
  onLoad: (accountId: string) => void;
  onLedger: () => void;
}) {
  return (
    <Card className="flex flex-col">
      <div className="flex items-start justify-between gap-3 p-4 sm:p-5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Store className="size-4 shrink-0 text-brand-accent" aria-hidden="true" />
            <h4 className="truncate text-[15px] font-bold text-fg">{account.name}</h4>
          </div>
          <p className="mt-1 truncate font-mono text-[11px] text-fg-faint">{account.id}</p>
        </div>
        {liveShift
          ? <Badge tone="success" dot>{liveShift.user_name}</Badge>
          : <Badge dot>Idle</Badge>}
      </div>
      <div className="px-4 pb-4 sm:px-5">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">Balance</p>
        <p className="mt-0.5 text-2xl font-bold tracking-tight text-fg"><Money amount={account.balance} tone={Number(account.balance) < 0 ? 'signed' : 'plain'} /></p>
        <div className="mt-2 flex flex-col gap-1 text-xs text-fg-subtle">
          {liveShift && <span>Shift since {formatPkTime(liveShift.started_at || liveShift.start_time)}</span>}
          {pendingHandover > 0 && (
            <span className="flex items-center gap-1.5"><ArrowRightLeft className="size-3.5" aria-hidden="true" /> Handover pending <Money amount={pendingHandover} className="font-semibold text-fg-muted" /></span>
          )}
        </div>
      </div>
      <div className="mt-auto flex flex-wrap gap-2 border-t border-line bg-surface-2/60 px-4 py-3 sm:px-5">
        <Button size="sm" variant="soft" leftIcon={<Plus />} loading={busy} disabled={disabled} onClick={() => onLoad(account.id)}>
          Add opening cash
        </Button>
        <Button size="sm" variant="ghost" leftIcon={<ExternalLink />} onClick={onLedger}>View ledger</Button>
      </div>
    </Card>
  );
});

export default DrawersPanel;
