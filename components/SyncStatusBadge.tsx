import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { syncService, SyncState } from '../lib/syncService';
import { db } from '../lib/db';
import { 
  Wifi, 
  WifiOff, 
  RefreshCw, 
  CheckCircle2, 
  AlertTriangle, 
  X, 
  ShoppingBag, 
  User, 
  FileText, 
  RotateCcw, 
  Clock, 
  ExternalLink 
} from 'lucide-react';
import { useToast } from '../context/ToastContext';
import { formatCurrency } from '../lib/formatters';

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

export const SyncStatusBadge: React.FC<SyncStatusBadgeProps> = ({ compact = false, className = '' }) => {
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
          amount: x.payload?.total_amount || x.payload?.amount || undefined,
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

  // When modal opens or syncState changes while modal is open, refresh the queue
  useEffect(() => {
    if (isModalOpen) {
      loadQueue();
    }
  }, [isModalOpen, loadQueue, syncState.pendingCount, syncState.failedCount]);

  // Handle escape to close modal
  useEffect(() => {
    if (!isModalOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setIsModalOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isModalOpen]);

  const handleBadgeClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (syncState.pendingCount > 0 || syncState.failedCount > 0) {
      setIsModalOpen(true);
    } else {
      handleManualSync();
    }
  };

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
    } else if (syncState.lastError) {
      showToast(`Sync notice: ${syncState.lastError}`, 'error');
    }
    await loadQueue();
  };

  const { isOnline, isSyncing, pendingCount, failedCount } = syncState;

  return (
    <>
      {compact ? (
        <button
          onClick={handleBadgeClick}
          disabled={isSyncing}
          title={
            !isOnline
              ? `Offline - ${pendingCount} records stored locally`
              : isSyncing
              ? 'Syncing with cloud...'
              : failedCount > 0
              ? `${failedCount} records failed sync - Click to view & retry`
              : pendingCount > 0
              ? `${pendingCount} pending records - Click to view queue`
              : 'Online - All records synced'
          }
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold transition-all cursor-pointer ${
            !isOnline
              ? 'bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300 border border-rose-300 dark:border-rose-800'
              : isSyncing
              ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300 border border-amber-300 dark:border-amber-800'
              : failedCount > 0
              ? 'bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300 border border-red-400 dark:border-red-800'
              : pendingCount > 0
              ? 'bg-orange-100 text-orange-800 dark:bg-orange-950/40 dark:text-orange-300 border border-orange-300 dark:border-orange-800'
              : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800'
          } ${className}`}
        >
          {!isOnline ? (
            <>
              <WifiOff size={13} className="text-rose-600 dark:text-rose-400" />
              <span>Offline {pendingCount > 0 ? `(${pendingCount})` : ''}</span>
            </>
          ) : isSyncing ? (
            <>
              <RefreshCw size={13} className="animate-spin text-amber-600 dark:text-amber-400" />
              <span>Syncing...</span>
            </>
          ) : failedCount > 0 ? (
            <>
              <AlertTriangle size={13} className="text-red-600 dark:text-red-400" />
              <span>{failedCount} Failed</span>
            </>
          ) : pendingCount > 0 ? (
            <>
              <RefreshCw size={13} className="text-orange-600 dark:text-orange-400" />
              <span>{pendingCount} Pending</span>
            </>
          ) : (
            <>
              <Wifi size={13} className="text-emerald-600 dark:text-emerald-400" />
              <span>Online</span>
            </>
          )}
        </button>
      ) : (
        <div
          onClick={handleBadgeClick}
          role="button"
          title={
            pendingCount > 0 || failedCount > 0
              ? 'Click to inspect pending/failed offline records'
              : 'Click to test cloud connection'
          }
          className={`inline-flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-1.5 rounded-xl border text-xs font-medium transition-all shadow-xs cursor-pointer select-none whitespace-nowrap shrink-0 active:scale-98 ${
            !isOnline
              ? 'bg-rose-50 hover:bg-rose-100/80 border-rose-200 text-rose-800 dark:bg-rose-950/30 dark:border-rose-800 dark:text-rose-300'
              : isSyncing
              ? 'bg-amber-50 hover:bg-amber-100/80 border-amber-200 text-amber-800 dark:bg-amber-950/30 dark:border-amber-800 dark:text-amber-300'
              : failedCount > 0
              ? 'bg-red-50 hover:bg-red-100/80 border-red-300 text-red-800 dark:bg-red-950/30 dark:border-red-800 dark:text-red-300'
              : pendingCount > 0
              ? 'bg-orange-50 hover:bg-orange-100/80 border-orange-200 text-orange-800 dark:bg-orange-950/30 dark:border-orange-800 dark:text-orange-300'
              : 'bg-emerald-50 hover:bg-emerald-100/80 border-emerald-200 text-emerald-800 dark:bg-emerald-950/30 dark:border-emerald-800 dark:text-emerald-300'
          } ${className}`}
        >
          <div className="flex items-center gap-1.5 shrink-0">
            {!isOnline ? (
              <span className="relative flex h-2 w-2 shrink-0">
                <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500"></span>
              </span>
            ) : isSyncing ? (
              <span className="relative flex h-2 w-2 shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
              </span>
            ) : failedCount > 0 ? (
              <span className="relative flex h-2 w-2 shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
              </span>
            ) : pendingCount > 0 ? (
              <span className="relative flex h-2 w-2 shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-orange-500"></span>
              </span>
            ) : (
              <span className="relative flex h-2 w-2 shrink-0">
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
            )}

            <div className="flex items-center gap-1 font-semibold">
              {!isOnline ? (
                <>
                  <WifiOff size={13} className="text-rose-600 dark:text-rose-400 shrink-0" />
                  <span className="hidden xl:inline">Offline (Local Active)</span>
                  <span className="xl:hidden hidden sm:inline text-xs">Offline</span>
                  <span className="sm:hidden text-[11px]">Offline</span>
                </>
              ) : isSyncing ? (
                <>
                  <RefreshCw size={13} className="animate-spin text-amber-600 dark:text-amber-400 shrink-0" />
                  <span className="hidden xl:inline">Syncing with Cloud...</span>
                  <span className="xl:hidden hidden sm:inline text-xs">Syncing...</span>
                  <span className="sm:hidden text-[11px]">Syncing</span>
                </>
              ) : failedCount > 0 ? (
                <>
                  <AlertTriangle size={13} className="text-red-600 dark:text-red-400 shrink-0" />
                  <span className="hidden xl:inline">{failedCount} Failed Sync</span>
                  <span className="xl:hidden hidden sm:inline text-xs">{failedCount} Failed</span>
                  <span className="sm:hidden text-[11px]">{failedCount} Fail</span>
                </>
              ) : pendingCount > 0 ? (
                <>
                  <RefreshCw size={13} className="text-orange-600 dark:text-orange-400 shrink-0" />
                  <span className="hidden xl:inline">{pendingCount} Pending Sync</span>
                  <span className="xl:hidden hidden sm:inline text-xs">{pendingCount} Pending</span>
                  <span className="sm:hidden text-[11px]">{pendingCount} Pend</span>
                </>
              ) : (
                <>
                  <CheckCircle2 size={13} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <span className="hidden xl:inline">Online (All Synced)</span>
                  <span className="xl:hidden hidden sm:inline text-xs">Synced</span>
                  <span className="sm:hidden text-[11px]">Online</span>
                </>
              )}
            </div>
          </div>

          {failedCount > 0 && isOnline && !isSyncing && (
            <span className="ml-0.5 sm:ml-1 px-1.5 py-0.5 rounded-md bg-red-200/70 dark:bg-red-900/60 text-[10px] font-bold text-red-900 dark:text-red-200 shrink-0">
              View
            </span>
          )}

          {failedCount === 0 && pendingCount > 0 && isOnline && !isSyncing && (
            <span className="ml-0.5 sm:ml-1 px-1.5 py-0.5 rounded-md bg-orange-200/70 dark:bg-orange-900/60 text-[10px] font-bold text-orange-900 dark:text-orange-200 shrink-0">
              Queue
            </span>
          )}
        </div>
      )}

      {/* Actionable Offline Sync Queue Modal */}
      {isModalOpen && typeof document !== 'undefined' && createPortal(
        <div 
          className="fixed inset-0 z-[120] flex items-center justify-center p-3 sm:p-4 bg-slate-950/70 backdrop-blur-xs animate-in fade-in duration-150"
          onClick={() => setIsModalOpen(false)}
        >
          <div 
            className="w-full max-w-xl max-h-[85vh] bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/70 dark:bg-slate-850/60 shrink-0">
              <div className="flex items-center gap-2.5">
                <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${
                  failedCount > 0
                    ? 'bg-rose-100 dark:bg-rose-950 text-rose-600 dark:text-rose-400'
                    : pendingCount > 0
                    ? 'bg-amber-100 dark:bg-amber-950 text-amber-600 dark:text-amber-400'
                    : 'bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400'
                }`}>
                  {failedCount > 0 ? (
                    <AlertTriangle size={18} />
                  ) : pendingCount > 0 ? (
                    <RefreshCw size={17} className={isSyncing ? 'animate-spin' : ''} />
                  ) : (
                    <CheckCircle2 size={18} />
                  )}
                </div>
                <div>
                  <h3 className="text-sm font-black text-slate-900 dark:text-white leading-tight">
                    Offline Data & Sync Queue
                  </h3>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className={`inline-flex items-center gap-1 text-[11px] font-bold ${
                      isOnline ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                    }`}>
                      {isOnline ? <Wifi size={11} /> : <WifiOff size={11} />}
                      {isOnline ? 'Cloud Reachable' : 'Offline Mode'}
                    </span>
                    <span className="text-slate-300 dark:text-slate-700">·</span>
                    <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                      {pendingCount} Pending · {failedCount} Failed
                    </span>
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
                title="Close dialog (Escape)"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Body: Queue List */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-3 min-h-0">
              {isLoadingQueue ? (
                <div className="py-12 flex flex-col items-center justify-center text-slate-400 dark:text-slate-500 gap-2">
                  <RefreshCw size={24} className="animate-spin text-lime-600 dark:text-lime-400" />
                  <span className="text-xs font-semibold">Reading local Dexie storage...</span>
                </div>
              ) : queueItems.length === 0 ? (
                <div className="py-12 flex flex-col items-center justify-center text-center px-4">
                  <div className="w-12 h-12 rounded-2xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mb-3">
                    <CheckCircle2 size={24} />
                  </div>
                  <h4 className="text-sm font-bold text-slate-900 dark:text-white">All Records Synchronized</h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mt-1">
                    Every local order, customer, and outbox ledger transaction is completely synced with Supabase.
                  </p>
                </div>
              ) : (
                queueItems.map((item) => {
                  const isFailed = item.sync_status === 'failed';
                  const Icon = item.type === 'order' ? ShoppingBag : item.type === 'customer' ? User : FileText;

                  return (
                    <div 
                      key={`${item.type}-${item.id}`}
                      className={`p-3.5 rounded-2xl border transition-all ${
                        isFailed
                          ? 'bg-rose-50/60 dark:bg-rose-950/20 border-rose-200 dark:border-rose-900/60'
                          : 'bg-white dark:bg-slate-850 border-slate-200 dark:border-slate-800 shadow-2xs'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-2.5 min-w-0">
                          <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${
                            isFailed
                              ? 'bg-rose-100 dark:bg-rose-900/50 text-rose-700 dark:text-rose-300'
                              : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                          }`}>
                            <Icon size={15} />
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-xs font-bold text-slate-900 dark:text-white truncate">
                                {item.title}
                              </span>
                              <span className={`text-[9px] font-black uppercase px-1.5 py-0.2 rounded-md tracking-wider ${
                                isFailed
                                  ? 'bg-rose-200 dark:bg-rose-900 text-rose-900 dark:text-rose-200'
                                  : 'bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300'
                              }`}>
                                {item.sync_status}
                              </span>
                            </div>
                            {item.subtitle && (
                              <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                                {item.subtitle}
                              </p>
                            )}
                          </div>
                        </div>

                        <div className="text-right shrink-0">
                          {item.amount !== undefined && (
                            <span className="text-xs font-mono font-black text-slate-900 dark:text-white block">
                              {formatCurrency(item.amount)}
                            </span>
                          )}
                          <span className="text-[10px] text-slate-400 dark:text-slate-500 font-medium flex items-center gap-1 justify-end mt-0.5">
                            <Clock size={10} />
                            {new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                      </div>

                      {/* Exact Sync Error Message (if failed) */}
                      {isFailed && item.sync_error && (
                        <div className="mt-2.5 p-2 bg-rose-100/70 dark:bg-rose-950/60 rounded-xl border border-rose-200 dark:border-rose-900 text-[11px] font-mono text-rose-900 dark:text-rose-200 break-words flex items-start gap-1.5">
                          <AlertTriangle size={13} className="text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                          <span>{item.sync_error}</span>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* Modal Footer Actions */}
            <div className="px-5 py-3.5 bg-slate-50 dark:bg-slate-850/80 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3 shrink-0">
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-200/60 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              >
                Close
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={loadQueue}
                  disabled={isLoadingQueue}
                  className="px-3 py-2 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/60 transition-all cursor-pointer flex items-center gap-1.5"
                  title="Refresh queue status"
                >
                  <RefreshCw size={13} className={isLoadingQueue ? 'animate-spin' : ''} />
                  <span>Refresh</span>
                </button>

                <button
                  type="button"
                  onClick={handleManualSync}
                  disabled={isSyncing || !isOnline || queueItems.length === 0}
                  className="px-4 py-2 rounded-xl text-xs font-black text-white bg-lime-600 hover:bg-lime-700 dark:bg-lime-500 dark:hover:bg-lime-400 dark:text-slate-950 transition-all shadow-xs cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5 active:scale-95"
                >
                  {isSyncing ? (
                    <>
                      <RefreshCw size={13} className="animate-spin" />
                      <span>Syncing...</span>
                    </>
                  ) : failedCount > 0 ? (
                    <>
                      <RotateCcw size={13} />
                      <span>Retry Failed ({failedCount})</span>
                    </>
                  ) : (
                    <>
                      <RefreshCw size={13} />
                      <span>Sync Now ({pendingCount})</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
};

export default SyncStatusBadge;

