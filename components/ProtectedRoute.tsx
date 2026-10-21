import React from 'react';
import { Navigate } from 'react-router-dom';
import { useDairy } from '../context/DairyContext';
import { PermissionModule } from '../types';

interface ProtectedRouteProps {
  module: PermissionModule;
  children: React.ReactNode;
}

const MODULE_ROUTE_MAP: Record<PermissionModule, string> = {
  dashboard: '/dashboard',
  purchase: '/purchase',
  allocation: '/allocation',
  pos: '/pos',
  sales_history: '/sales-history',
  customer_orders: '/customer-orders',
  retail_stock: '/cash-control',
  cash_control: '/cash-control',
  production: '/production',
  items: '/items',
  inventory: '/inventory',
  customers: '/customers',
  suppliers: '/suppliers',
  expenses: '/expenses',
  bank_cash: '/bank-cash',
  accounts: '/accounts',
  reports: '/reports',
  settings: '/settings',
  user_management: '/settings'
};

import { PageLoadingFallback } from './PageLoadingFallback';
import { Lock, RefreshCw, AlertTriangle } from 'lucide-react';

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ module, children }) => {
  const { hasPermission, currentRole, currentUser, isBooting, sessionError, isDataLoading, hasLoadedData, dataLoadError, retryLoading } = useDairy();

  // Wait for the saved session to be restored before judging access,
  // otherwise a hard refresh on any route bounces to the fallback.
  if (isBooting) {
    return <PageLoadingFallback message="Checking your session" submessage="Verifying operator access" />;
  }

  // Only block the screen if there is no authenticated user to fall back on
  if ((sessionError && !currentUser) || (!hasLoadedData && dataLoadError && !isDataLoading && !currentUser)) {
    return <div role="alert" className="mx-auto my-10 max-w-lg rounded-2xl border border-amber-200 bg-amber-50 p-6 dark:border-amber-900 dark:bg-amber-950/20">
      <AlertTriangle size={24} className="mb-3 text-amber-600" />
      <h3 className="font-bold text-slate-900 dark:text-white">{sessionError ? 'Connection needed to verify access' : 'Workspace could not finish loading'}</h3>
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{sessionError || dataLoadError}</p>
      <button type="button" disabled={isDataLoading} onClick={() => void retryLoading()} className="mt-4 inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"><RefreshCw size={15} />{isDataLoading ? 'Finishing current request…' : 'Try again'}</button>
    </div>;
  }

  // If no user is authenticated, terminal is locked — wait for UserSwitcherModal
  if (!currentUser) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] p-8 text-center">
        <div className="w-12 h-12 rounded-2xl bg-amber-500/10 text-amber-500 flex items-center justify-center mb-4">
          <Lock className="w-6 h-6" />
        </div>
        <h3 className="text-base font-bold text-slate-800 dark:text-slate-200">Terminal Locked</h3>
        <p className="text-xs text-slate-500 mt-1 max-w-xs">Please select a user and enter your PIN code to access the system.</p>
      </div>
    );
  }

  // Settings also holds the Users & Access tab, so a user manager without the settings
  // permission still gets in (Settings then shows only that tab).
  const isAllowed = hasPermission(module) || (module === 'settings' && hasPermission('user_management'));

  if (isAllowed) {
    // Never present initial zero balances as actual data, or remount a working
    // screen just because a background refresh is underway.
    if (!hasLoadedData) return <PageLoadingFallback message="Loading your workspace" submessage="Fetching current stock and account balances" />;
    return <>
      {(isDataLoading || dataLoadError || sessionError) && <div role="status" className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
        <span>{isDataLoading ? 'Refreshing records in the background…' : (sessionError || dataLoadError)}</span>
        {(dataLoadError || sessionError) && !isDataLoading && <button type="button" onClick={() => void retryLoading()} className="font-bold text-emerald-700 dark:text-emerald-400">Retry</button>}
      </div>}
      {children}
    </>;
  }

  // Find user's first allowed landing route (role permissions + user extras)
  const allowedModules = [
    ...(currentRole?.permissions || []),
    ...(currentUser?.permissions || [])
  ];
  // Permissions are stored as modules ('pos') or actions ('pos:view'); only redirect to a page
  // this user can actually open, never back to this one (that would redirect forever).
  // Settings is the last resort.
  const reachable = allowedModules
    .map(perm => String(perm).split(':')[0] as PermissionModule)
    .filter(mod => MODULE_ROUTE_MAP[mod] && MODULE_ROUTE_MAP[mod] !== MODULE_ROUTE_MAP[module] && hasPermission(mod))
    .map(mod => MODULE_ROUTE_MAP[mod]);
  const fallbackRoute: string | null = reachable.find(route => route !== '/settings') || reachable[0] || null;

  if (!fallbackRoute) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] p-8 text-center">
        <div className="w-12 h-12 rounded-2xl bg-amber-500/10 text-amber-500 flex items-center justify-center mb-4">
          <Lock className="w-6 h-6" />
        </div>
        <h3 className="text-base font-bold text-slate-800 dark:text-slate-200">Access nahi hai</h3>
        <p className="text-xs text-slate-500 mt-1 max-w-xs">Is page ki ijazat aap ke role mein nahi hai. Admin se rabta karein.</p>
      </div>
    );
  }

  return <Navigate to={fallbackRoute} replace />;
};

export default ProtectedRoute;
