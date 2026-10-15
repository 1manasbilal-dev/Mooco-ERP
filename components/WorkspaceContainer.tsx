import React, { Activity, Suspense, lazy, useEffect, useState } from 'react';
import { useTabs, WorkspaceTab } from '../context/TabContext';
import ProtectedRoute from './ProtectedRoute';
import { PageLoadingFallback } from './PageLoadingFallback';


// Lazy Loaded Route Modules
const loadDashboard = () => import('../pages/Dashboard');
const Dashboard = lazy(loadDashboard);
const Purchase = lazy(() => import('../pages/Purchase'));
const MilkCollectionDetails = lazy(() => import('../pages/MilkCollectionDetails'));
const Allocation = lazy(() => import('../pages/Allocation'));
const Production = lazy(() => import('../pages/Production'));
const POS = lazy(() => import('../pages/POS'));
const SalesHistory = lazy(() => import('../pages/SalesHistory'));
const CashControl = lazy(() => import('../pages/CashControl'));
const Items = lazy(() => import('../pages/Items'));
const Inventory = lazy(() => import('../pages/Inventory'));
const Customers = lazy(() => import('../pages/Customers'));
const CustomerOrders = lazy(() => import('../pages/CustomerOrders'));
const Suppliers = lazy(() => import('../pages/Suppliers'));
const Expenses = lazy(() => import('../pages/Expenses'));
const BankCash = lazy(() => import('../pages/BankCash'));
const Accounts = lazy(() => import('../pages/Accounts'));
const Reports = lazy(() => import('../pages/Reports'));
const Settings = lazy(() => import('../pages/Settings'));

interface WorkspaceContainerProps {
  themeMode: 'light' | 'dark';
  toggleTheme: () => void;
}

export const WorkspaceContainer: React.FC<WorkspaceContainerProps> = ({ themeMode, toggleTheme }) => {
  const {
    tabs,
    activeTabId,
    closeTab
  } = useTabs();

  const [visitedTabs, setVisitedTabs] = useState(() => new Set([activeTabId]));
  useEffect(() => {
    setVisitedTabs(previous => {
      const next = new Set(tabs.filter(tab => tab.id === activeTabId || previous.has(tab.id)).map(tab => tab.id));
      if (next.size === previous.size && [...next].every(id => previous.has(id))) return previous;
      return next;
    });
  }, [tabs, activeTabId]);

  // Download the initial dashboard module while session/data requests are running.
  useEffect(() => {
    if (activeTabId === 'dashboard') void loadDashboard().catch(() => {});
  }, [activeTabId]);

  // Render content of a single tab
  const renderModuleComponent = (tab: WorkspaceTab) => {
    switch (tab.id) {
      case 'dashboard':
        return (
          <ProtectedRoute module="dashboard">
            <Dashboard />
          </ProtectedRoute>
        );
      case 'purchase':
        return (
          <ProtectedRoute module="purchase">
            <Purchase view="milk" />
          </ProtectedRoute>
        );
      case 'purchase-supplies':
        return (
          <ProtectedRoute module="purchase">
            <Purchase view="supplies" />
          </ProtectedRoute>
        );
      case 'purchase-details':
        return (
          <ProtectedRoute module="purchase">
            <MilkCollectionDetails />
          </ProtectedRoute>
        );
      case 'allocation':
        return (
          <ProtectedRoute module="allocation">
            <Allocation />
          </ProtectedRoute>
        );
      case 'production':
        return (
          <ProtectedRoute module="production">
            <Production />
          </ProtectedRoute>
        );
      case 'pos':
        return (
          <ProtectedRoute module="pos">
            <POS />
          </ProtectedRoute>
        );

      case 'sales-history':
        return (
          <ProtectedRoute module="sales_history">
            <SalesHistory />
          </ProtectedRoute>
        );
      case 'cash-control':
        return (
          <ProtectedRoute module="cash_control">
            <CashControl />
          </ProtectedRoute>
        );
      case 'items':
        return (
          <ProtectedRoute module="items">
            <Items />
          </ProtectedRoute>
        );
      case 'inventory':
        return (
          <ProtectedRoute module="inventory">
            <Inventory />
          </ProtectedRoute>
        );
      case 'customers':
        return (
          <ProtectedRoute module="customers">
            <Customers />
          </ProtectedRoute>
        );
      case 'customer-orders':
        return <ProtectedRoute module="customer_orders"><CustomerOrders /></ProtectedRoute>;
      case 'suppliers':
        return (
          <ProtectedRoute module="suppliers">
            <Suppliers />
          </ProtectedRoute>
        );
      case 'expenses':
        return (
          <ProtectedRoute module="expenses">
            <Expenses />
          </ProtectedRoute>
        );
      case 'bank-cash':
        return (
          <ProtectedRoute module="bank_cash">
            <BankCash />
          </ProtectedRoute>
        );
      case 'accounts':
        return (
          <ProtectedRoute module="accounts">
            <Accounts />
          </ProtectedRoute>
        );
      case 'reports':
        return (
          <ProtectedRoute module="reports">
            <Reports />
          </ProtectedRoute>
        );
      case 'settings':
        return (
          <ProtectedRoute module="settings">
            <Settings onBack={() => closeTab(tab.id)} themeMode={themeMode} toggleTheme={toggleTheme} />
          </ProtectedRoute>
        );
      default:
        return (
          <ProtectedRoute module="dashboard">
            <Dashboard />
          </ProtectedRoute>
        );
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 h-full w-full overflow-hidden relative">
      <div className="flex-1 flex flex-col min-h-0 h-full w-full overflow-hidden">
        {tabs.map(tab => {
          const isCurrent = tab.id === activeTabId;
          const isPos = tab.id === 'pos';
          const isContained = isPos || tab.id === 'reports';
          // Saved tabs stay in navigation without downloading/mounting their pages.
          if (!isCurrent && !visitedTabs.has(tab.id)) return null;

          return (
            <Activity key={tab.id} mode={isCurrent ? 'visible' : 'hidden'}>
            <div
              data-module={tab.id}
              className={`workspace-pane w-full h-full flex-1 flex flex-col min-h-0 ${isContained ? 'overflow-hidden' : 'overflow-y-auto'}`}
            >
              <div className={`workspace-page w-full ${isContained ? 'flex-1 flex flex-col min-h-0 h-full' : 'min-h-full'} ${isPos ? '' : `px-3 sm:px-4 md:px-8 ${isContained ? 'pb-4' : 'pb-8'} pt-2 max-w-[1600px] mx-auto`}`}>
                <Suspense fallback={<PageLoadingFallback />}>
                  {renderModuleComponent(tab)}
                </Suspense>
              </div>
            </div>
            </Activity>
          );
        })}
      </div>
    </div>
  );
};
export default WorkspaceContainer;
