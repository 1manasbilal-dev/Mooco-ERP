import React, { useState, useEffect } from 'react';
import { syncService, SyncState } from '../lib/syncService';
import { Wifi, WifiOff, RefreshCw, CheckCircle2, AlertTriangle } from 'lucide-react';
import { useToast } from '../context/ToastContext';

interface SyncStatusBadgeProps {
  compact?: boolean;
  className?: string;
}

export const SyncStatusBadge: React.FC<SyncStatusBadgeProps> = ({ compact = false, className = '' }) => {
  const [syncState, setSyncState] = useState<SyncState>(syncService.getState());
  const { showToast } = useToast();

  useEffect(() => {
    const unsubscribe = syncService.subscribe((state) => {
      setSyncState(state);
    });
    return () => unsubscribe();
  }, []);

  const handleManualSync = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!syncState.isOnline) {
      showToast('Device is offline. Changes are saved locally and will sync once connected.', 'warning');
      return;
    }

    if (syncState.isSyncing) return;

    if (syncState.failedCount > 0) {
      showToast('Retrying failed sync records...', 'info');
      await syncService.retryFailedRecords();
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
  };

  const { isOnline, isSyncing, pendingCount, failedCount } = syncState;

  if (compact) {
    return (
      <button
        onClick={handleManualSync}
        disabled={isSyncing}
        title={
          !isOnline
            ? `Offline - ${pendingCount} records stored locally`
            : isSyncing
            ? 'Syncing with cloud...'
            : failedCount > 0
            ? `${failedCount} records failed sync - Click to retry`
            : pendingCount > 0
            ? `${pendingCount} pending records - Click to sync now`
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
            <span>{failedCount} Failed (Retry)</span>
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
    );
  }

  return (
    <div
      onClick={handleManualSync}
      role="button"
      title="Click to sync pending records or retry failed items"
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
              <span className="hidden md:inline">Offline (Local Active)</span>
              <span className="md:hidden text-[11px]">Offline</span>
            </>
          ) : isSyncing ? (
            <>
              <RefreshCw size={13} className="animate-spin text-amber-600 dark:text-amber-400 shrink-0" />
              <span className="hidden md:inline">Syncing with Cloud...</span>
              <span className="md:hidden text-[11px]">Syncing...</span>
            </>
          ) : failedCount > 0 ? (
            <>
              <AlertTriangle size={13} className="text-red-600 dark:text-red-400 shrink-0" />
              <span className="hidden md:inline">{failedCount} Failed Sync</span>
              <span className="md:hidden text-[11px]">{failedCount} Failed</span>
            </>
          ) : pendingCount > 0 ? (
            <>
              <RefreshCw size={13} className="text-orange-600 dark:text-orange-400 shrink-0" />
              <span className="hidden md:inline">{pendingCount} Pending Sync</span>
              <span className="md:hidden text-[11px]">{pendingCount} Pending</span>
            </>
          ) : (
            <>
              <CheckCircle2 size={13} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span className="hidden md:inline">Online (All Synced)</span>
              <span className="md:hidden text-[11px]">Online</span>
            </>
          )}
        </div>
      </div>

      {failedCount > 0 && isOnline && !isSyncing && (
        <span className="ml-1 px-1.5 py-0.5 rounded-md bg-red-200/70 dark:bg-red-900/60 text-[10px] font-bold text-red-900 dark:text-red-200 shrink-0">
          Retry
        </span>
      )}

      {failedCount === 0 && pendingCount > 0 && isOnline && !isSyncing && (
        <span className="ml-1 px-1.5 py-0.5 rounded-md bg-orange-200/70 dark:bg-orange-900/60 text-[10px] font-bold text-orange-900 dark:text-orange-200 shrink-0">
          Sync
        </span>
      )}
    </div>
  );
};

export default SyncStatusBadge;
