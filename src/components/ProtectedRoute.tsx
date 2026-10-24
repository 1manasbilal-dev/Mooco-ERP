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
import { Lock, RefreshCw, AlertTriangle, Loader2 } from 'lucide-react';
import { Button } from './ui/Button';
import { EmptyState } from './ui/EmptyState';

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ module, children }) => {
  const { hasPermission, currentRole, currentUser, isBooting, sessionError, isDataLoading, hasLoadedData, dataLoadError, retryLoading } = useDairy();

  // Wait for the saved session to be restored before judging access,
  // otherwise a hard refresh on any route bounces to the fallback.
  if (isBooting) {
    return <PageLoadingFallback message="Checking your session" submessage="Verifying operator access" />;
  }

  // Only block the screen if there is no authenticated user to fall back on
  if ((sessionError && !currentUser) || (!hasLoadedData && dataLoadError && !isDataLoading && !currentUser)) {
    return <div role="alert" className="mx-auto my-10 max-w-lg rounded-card border border-line bg-surface p-6 shadow-e1">
      <span className="mb-4 flex size-11 items-center justify-center rounded-xl bg-warning-soft text-warning-fg ring-1 ring-inset ring-warning/25"><AlertTriangle size={22} /></span>
      <h3 className="text-[15px] font-bold text-fg">{sessionError ? 'Connection needed to verify access' : 'Workspace could not finish loading'}</h3>
      <p className="mt-1.5 text-sm text-fg-subtle">{sessionError || dataLoadError}</p>
      <Button className="mt-5" loading={isDataLoading} leftIcon={<RefreshCw />} onClick={() => void retryLoading()}>{isDataLoading ? 'Finishing current request…' : 'Try again'}</Button>
    </div>;
  }

  // If no user is authenticated, terminal is locked — wait for UserSwitcherModal
  if (!currentUser) {
    return (
      <EmptyState
        className="min-h-[50vh]"
        icon={<Lock />}
        title="Terminal Locked"
        description="Please select a user and enter your PIN code to access the system."
      />
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
      {(isDataLoading || dataLoadError || sessionError) && <div role="status" className={`mb-3 flex flex-wrap items-center justify-between gap-2 rounded-control px-3 py-2 text-xs font-medium ring-1 ring-inset ${isDataLoading ? 'bg-surface-2 text-fg-subtle ring-line' : 'bg-warning-soft text-warning-fg ring-warning/25'}`}>
        <span className="flex items-center gap-2">
          {isDataLoading ? <Loader2 size={13} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <AlertTriangle size={13} aria-hidden="true" />}
          {isDataLoading ? 'Refreshing records in the background…' : (sessionError || dataLoadError)}
        </span>
        {(dataLoadError || sessionError) && !isDataLoading && <Button variant="ghost" size="sm" className="h-7 text-brand-fg hover:bg-brand-soft hover:text-brand-fg" onClick={() => void retryLoading()}>Retry</Button>}
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
      <EmptyState
        className="min-h-[50vh]"
        icon={<Lock />}
        title="No access"
        description="Your role doesn't have permission for this page. Please contact the admin."
      />
    );
  }

  return <Navigate to={fallbackRoute} replace />;
};

export default ProtectedRoute;
