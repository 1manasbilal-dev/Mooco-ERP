import React, { useState, useEffect, useCallback, memo } from 'react';
import { syncService, SyncState } from '../lib/syncService';
import { db } from '../lib/db';
import {
  Wifi,
  WifiOff,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  ShoppingBag,
  User,
  FileText,
  RotateCcw,
  Clock,
  CloudUpload,
} from 'lucide-react';
import { useToast } from '../context/ToastContext';
import { formatCurrency } from '../lib/formatters';
import { cn } from '../lib/cn';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';

interface SyncStatusBadgeProps {
  compact?: boolean;
  className?: string;
}

interface OfflineQueueItem {
  id: string;
  type: 'order' | 'customer' | 'outbox';
  title: string;
  subtitle?: string;
  amount?: number;
  sync_status: 'pending' | 'failed' | 'synced';
  sync_error?: string;
  retry_count?: number;
  created_at: string;
}

type SyncTone = 'ok' | 'syncing' | 'pending' | 'failed' | 'offline';

// Rings, not borders, so the legacy dark layer in index.css never repaints the tone.
const TONE_CLASS: Record<SyncTone, string> = {
  ok: 'bg-surface-2 text-fg-muted ring-line hover:bg-surface-3',
  syncing: 'bg-info-soft text-info-fg ring-info/20',
  pending: 'bg-warning-soft text-warning-fg ring-warning/25 hover:bg-warning/15',
  failed: 'bg-danger-soft text-danger-fg ring-danger/20 hover:bg-danger/15',
  offline: 'bg-warning-soft text-warning-fg ring-warning/25 hover:bg-warning/15',
};
const DOT_CLASS: Record<SyncTone, string> = {
  ok: 'bg-success', syncing: 'bg-info', pending: 'bg-warning', failed: 'bg-danger', offline: 'bg-warning',
};

const SyncStatusBadge: React.FC<SyncStatusBadgeProps> = ({ compact = false, className = '' }) => {
  const [syncState, setSyncState] = useState<SyncState>(syncService.getState());
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [queueItems, setQueueItems] = useState<OfflineQueueItem[]>([]);
  const [isLoadingQueue, setIsLoadingQueue] = useState(false);
  const { showToast } = useToast();

  useEffect(() => {
    const unsubscribe = syncService.subscribe((state) => {
      setSyncState(state);
    });
    return () => unsubscribe();
  }, []);

  const loadQueue = useCallback(async () => {
    setIsLoadingQueue(true);
    try {
      const [orders, customers, outbox] = await Promise.all([
        db.orders.where('sync_status').anyOf(['pending', 'failed']).toArray().catch(() => []),
        db.customers.where('sync_status').anyOf(['pending', 'failed']).toArray().catch(() => []),
        db.outbox.where('sync_status').anyOf(['pending', 'failed']).toArray().catch(() => []),
      ]);

      const items: OfflineQueueItem[] = [
        ...orders.map(o => ({
          id: o.id,
          type: 'order' as const,
          title: `POS Bill #${o.bill_number}`,
          subtitle: `${o.customer_name || 'Walk-in'} · ${o.items?.length || 0} items`,
          amount: o.total,
          sync_status: o.sync_status,
          sync_error: o.sync_error,
          retry_count: o.retry_count,
          created_at: o.created_at,
        })),
        ...customers.map(c => ({
          id: c.id,
          type: 'customer' as const,
          title: `Customer: ${c.name}`,
          subtitle: c.phone || 'No phone recorded',
          sync_status: c.sync_status,
          sync_error: c.sync_error,
          retry_count: c.retry_count,
          created_at: c.created_at,
        })),
        ...outbox.map(x => ({
          id: x.id,
          type: 'outbox' as const,
          title: `Accounting: ${String(x.action_type || 'entry').replace(/_/g, ' ').toUpperCase()}`,
          subtitle: `Ref: ${x.idempotency_key ? x.idempotency_key.slice(0, 10) : x.id.slice(0, 8)}`,
          amount: x.payload?.total_amount || x.payload?.amount || x.payload?.p_amount || undefined,
          sync_status: x.sync_status,
          sync_error: x.sync_error,
          retry_count: x.retry_count,
          created_at: x.created_at,
        })),
      ];

      items.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      setQueueItems(items);
    } catch (err) {
      console.warn('[SyncStatusBadge] Failed to load offline sync queue:', err);
    } finally {
      setIsLoadingQueue(false);
    }
  }, []);

  useEffect(() => {
    if (isModalOpen) {
      loadQueue();
    }
  }, [isModalOpen, loadQueue, syncState.pendingCount, syncState.failedCount]);

  const handleManualSync = async () => {
    if (!syncState.isOnline) {
      showToast('Device is offline. Changes are saved safely in local storage and will sync automatically once connected.', 'warning');
      return;
    }

    if (syncState.isSyncing) return;

    if (syncState.failedCount > 0) {
      showToast('Retrying failed sync records...', 'info');
      await syncService.retryFailedRecords();
      await loadQueue();
      return;
    }

    showToast('Starting background sync...', 'info');
    const result = await syncService.syncPending();
    if (result.success) {
      const synced = result.syncedOrders + result.syncedCustomers + (result.syncedOutbox || 0);
      if (synced > 0) {
        showToast(`Synced ${synced} local records to the cloud.`, 'success');
      } else {
        showToast('All local data is up-to-date with cloud.', 'success');
      }
    } else {
      // The render-time syncState is from before this run; read the error this run produced.
      const { lastError } = syncService.getState();
      if (lastError) showToast(`Sync notice: ${lastError}`, 'error');
    }
    await loadQueue();
  };

  const handleBadgeClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (syncState.pendingCount > 0 || syncState.failedCount > 0) {
      setIsModalOpen(true);
    } else {
      handleManualSync();
    }
  };

  const { isOnline, isSyncing, pendingCount, failedCount } = syncState;
  const tone: SyncTone = !isOnline ? 'offline' : isSyncing ? 'syncing' : failedCount > 0 ? 'failed' : pendingCount > 0 ? 'pending' : 'ok';

  const label = {
    offline: `Offline${pendingCount > 0 ? ` (${pendingCount})` : ''}`,
    syncing: 'Syncing…',
    failed: `${failedCount} failed`,
    pending: `${pendingCount} pending`,
    ok: 'Synced',
  }[tone];
  const description = {
    offline: `Offline - ${pendingCount} records stored locally. Changes sync automatically once connected.`,
    syncing: 'Syncing with cloud...',
    failed: `${failedCount} records failed sync - Click to view & retry`,
    pending: `${pendingCount} pending records - Click to view queue`,
    ok: 'Online - All records synced. Click to check the cloud connection.',
  }[tone];
  // Phones show only the dot and icon while all is well; offline and failures always say so in words.
  const alwaysShowLabel = tone === 'offline' || tone === 'failed';
  const Icon = tone === 'offline' ? WifiOff : tone === 'failed' ? AlertTriangle : tone === 'ok' ? CheckCircle2 : RefreshCw;

  return (
    <>
      <button
        type="button"
        onClick={handleBadgeClick}
        title={description}
        aria-label={`Sync status: ${description}`}
        aria-busy={isSyncing || undefined}
        className={cn(
          'inline-flex shrink-0 cursor-pointer select-none items-center gap-1.5 whitespace-nowrap rounded-full font-semibold ring-1 ring-inset transition-colors duration-150',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          compact ? 'h-7 px-2.5 text-[11px]' : 'h-8 px-2.5 text-xs',
          TONE_CLASS[tone],
          className,
        )}
      >
        <span className="relative flex size-2 shrink-0" aria-hidden="true">
          {(tone === 'syncing' || tone === 'failed') && <span className={cn('absolute inset-0 animate-ping rounded-full opacity-60 motion-reduce:animate-none', DOT_CLASS[tone])} />}
          <span className={cn('relative size-2 rounded-full', DOT_CLASS[tone])} />
        </span>
        <Icon size={13} className={cn('shrink-0', tone === 'syncing' && 'animate-spin motion-reduce:animate-none', !alwaysShowLabel && 'hidden sm:block')} aria-hidden="true" />
        <span className={cn('tabular-nums', !alwaysShowLabel && 'hidden sm:inline')}>{label}</span>
      </button>

      <Modal
        open={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        size="lg"
        title="Offline Data & Sync Queue"
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className={cn('inline-flex items-center gap-1 font-semibold', isOnline ? 'text-success-fg' : 'text-warning-fg')}>
              {isOnline ? <Wifi size={13} aria-hidden="true" /> : <WifiOff size={13} aria-hidden="true" />}
              {isOnline ? 'Cloud Reachable' : 'Offline Mode'}
            </span>
            <span className="text-fg-faint" aria-hidden="true">·</span>
            <span className="tabular-nums">{pendingCount} Pending · {failedCount} Failed</span>
          </span>
        }
        icon={
          <span className={cn(
            'flex size-10 items-center justify-center rounded-xl ring-1 ring-inset',
            failedCount > 0 ? 'bg-danger-soft text-danger-fg ring-danger/20' : pendingCount > 0 ? 'bg-warning-soft text-warning-fg ring-warning/25' : 'bg-success-soft text-success-fg ring-success/20'
          )}>
            {failedCount > 0 ? <AlertTriangle size={19} /> : pendingCount > 0 ? <CloudUpload size={19} /> : <CheckCircle2 size={19} />}
          </span>
        }
        footer={<>
          <Button variant="ghost" onClick={() => setIsModalOpen(false)} className="sm:mr-auto">Close</Button>
          <Button variant="secondary" leftIcon={<RefreshCw className={isLoadingQueue ? 'animate-spin' : ''} />} onClick={loadQueue} disabled={isLoadingQueue} title="Refresh queue status">
            Refresh
          </Button>
          <Button
            onClick={handleManualSync}
            loading={isSyncing}
            disabled={!isOnline || queueItems.length === 0}
            leftIcon={failedCount > 0 ? <RotateCcw /> : <RefreshCw />}
          >
            {isSyncing ? 'Syncing...' : failedCount > 0 ? `Retry Failed (${failedCount})` : `Sync Now (${pendingCount})`}
          </Button>
        </>}
      >
        <div className="space-y-2.5 pb-2">
          {isLoadingQueue && queueItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-fg-subtle">
              <RefreshCw size={22} className="animate-spin text-brand-accent" aria-hidden="true" />
              <span className="text-xs font-semibold">Reading local Dexie storage...</span>
            </div>
          ) : queueItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
              <span className="mb-3 flex size-12 items-center justify-center rounded-2xl bg-success-soft text-success-fg ring-1 ring-inset ring-success/20">
                <CheckCircle2 size={24} aria-hidden="true" />
              </span>
              <h4 className="text-sm font-bold text-fg">All Records Synchronized</h4>
              <p className="mt-1 max-w-sm text-xs text-fg-subtle">
                Every local order, customer, and outbox ledger transaction is completely synced with Supabase.
              </p>
            </div>
          ) : (
            queueItems.map(item => <QueueRow key={`${item.type}-${item.id}`} item={item} />)
          )}
        </div>
      </Modal>
    </>
  );
};

const QueueRow = memo(({ item }: { item: OfflineQueueItem }) => {
  const isFailed = item.sync_status === 'failed';
  const Icon = item.type === 'order' ? ShoppingBag : item.type === 'customer' ? User : FileText;

  return (
    <div className={cn('rounded-control p-3.5 ring-1 ring-inset', isFailed ? 'bg-danger-soft/50 ring-danger/20' : 'bg-surface ring-line')}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className={cn('mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg', isFailed ? 'bg-danger-soft text-danger-fg' : 'bg-surface-2 text-fg-subtle')}>
            <Icon size={15} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="truncate text-[13px] font-bold text-fg">{item.title}</span>
              <span className={cn(
                'rounded-md px-1.5 text-[10px] font-bold uppercase tracking-wider',
                isFailed ? 'bg-danger text-white' : 'bg-warning-soft text-warning-fg'
              )}>
                {item.sync_status}
              </span>
            </div>
            {item.subtitle && <p className="mt-0.5 truncate text-xs text-fg-subtle">{item.subtitle}</p>}
          </div>
        </div>

        <div className="shrink-0 text-right">
          {item.amount !== undefined && (
            <span className="block text-[13px] font-bold tabular-nums text-fg">{formatCurrency(item.amount)}</span>
          )}
          <span className="mt-0.5 flex items-center justify-end gap-1 text-[11px] font-medium text-fg-faint">
            <Clock size={10} aria-hidden="true" />
            {new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
      </div>

      {/* Shown when failed, or still retrying after an error */}
      {item.sync_error && (isFailed || (item.retry_count || 0) > 0) && (
        <div className="mt-2.5 flex items-start gap-1.5 break-words rounded-lg bg-danger-soft p-2 font-mono text-[11px] text-danger-fg ring-1 ring-inset ring-danger/20">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{item.sync_error}</span>
        </div>
      )}
    </div>
  );
});
QueueRow.displayName = 'QueueRow';

export default memo(SyncStatusBadge);
