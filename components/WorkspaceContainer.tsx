import React, { Suspense, lazy, memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTabs, WorkspaceTab } from '../context/TabContext';
import { DairyFreeze } from '../context/DairyContext';
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

// Recently opened pages stay mounted (hidden) so returning to them is instant and keeps their state.
const KEEP_ALIVE_LIMIT = 4;

export const WorkspaceContainer: React.FC<WorkspaceContainerProps> = ({ themeMode, toggleTheme }) => {
  const { activeTab, activeTabId, goBack } = useTabs();

  // Stable callbacks so the memoized panes are not re-rendered by a new function identity.
  const toggleThemeRef = useRef(toggleTheme);
  toggleThemeRef.current = toggleTheme;
  const goBackRef = useRef(goBack);
  goBackRef.current = goBack;
  const stableToggleTheme = useCallback(() => toggleThemeRef.current(), []);
  const stableGoBack = useCallback(() => goBackRef.current(), []);

  const [recentPages, setRecentPages] = useState<WorkspaceTab[]>(() => [activeTab]);
  useEffect(() => {
    setRecentPages(previous => {
      if (previous[0]?.id === activeTabId) return previous[0] === activeTab ? previous : [activeTab, ...previous.slice(1)];
      return [activeTab, ...previous.filter(page => page.id !== activeTabId)].slice(0, KEEP_ALIVE_LIMIT);
    });
  }, [activeTab, activeTabId]);

  // Download the initial dashboard module while session/data requests are running.
  useEffect(() => {
    if (activeTabId === 'dashboard') void loadDashboard().catch(() => {});
  }, [activeTabId]);

  return (
    <div className="flex-1 flex flex-col min-h-0 h-full w-full overflow-hidden relative">
      {recentPages.map(tab => (
        <WorkspacePane
          key={tab.id}
          tab={tab}
          isVisible={tab.id === activeTabId}
          themeMode={themeMode}
          toggleTheme={stableToggleTheme}
          goBack={stableGoBack}
        />
      ))}
    </div>
  );
};

interface ModuleContentProps {
  tab: WorkspaceTab;
  themeMode: 'light' | 'dark';
  toggleTheme: () => void;
  goBack: () => void;
}

// One kept-alive page. Hidden pages are frozen on the data they last showed, so a
// sale or a sync only re-renders the page on screen; they catch up when reopened.
const WorkspacePane = memo(({ isVisible, ...content }: ModuleContentProps & { isVisible: boolean }) => {
  const isPos = content.tab.id === 'pos';
  const isContained = isPos || content.tab.id === 'reports';

  return (
    <div
      data-module={content.tab.id}
      data-active={isVisible ? 'true' : 'false'}
      style={{ display: isVisible ? 'flex' : 'none' }}
      className={`workspace-pane w-full h-full flex-1 flex flex-col min-h-0 ${isContained ? 'overflow-hidden' : 'overflow-y-auto'}`}
    >
      <div className={`workspace-page w-full ${isContained ? 'flex-1 flex flex-col min-h-0 h-full' : 'min-h-full'} ${isPos ? '' : `px-3 sm:px-4 md:px-8 ${isContained ? 'pb-4' : 'pb-8'} pt-4 max-w-[1600px] mx-auto`}`}>
        <DairyFreeze frozen={!isVisible}>
          <Suspense fallback={<PageLoadingFallback />}>
            <ModuleContent {...content} />
          </Suspense>
        </DairyFreeze>
      </div>
    </div>
  );
});

// Render content of a single tab
const ModuleContent = memo(({ tab, themeMode, toggleTheme, goBack }: ModuleContentProps) => {
  switch (tab.id) {
    case 'purchase':
      return <ProtectedRoute module="purchase"><Purchase view="milk" /></ProtectedRoute>;
    case 'purchase-supplies':
      return <ProtectedRoute module="purchase"><Purchase view="supplies" /></ProtectedRoute>;
    case 'purchase-details':
      return <ProtectedRoute module="purchase"><MilkCollectionDetails /></ProtectedRoute>;
    case 'allocation':
      return <ProtectedRoute module="allocation"><Allocation /></ProtectedRoute>;
    case 'production':
      return <ProtectedRoute module="production"><Production /></ProtectedRoute>;
    case 'pos':
      return <ProtectedRoute module="pos"><POS /></ProtectedRoute>;
    case 'sales-history':
      return <ProtectedRoute module="sales_history"><SalesHistory /></ProtectedRoute>;
    case 'cash-control':
      return <ProtectedRoute module="cash_control"><CashControl /></ProtectedRoute>;
    case 'items':
      return <ProtectedRoute module="items"><Items /></ProtectedRoute>;
    case 'inventory':
      return <ProtectedRoute module="inventory"><Inventory /></ProtectedRoute>;
    case 'customers':
      return <ProtectedRoute module="customers"><Customers /></ProtectedRoute>;
    case 'customer-orders':
      return <ProtectedRoute module="customer_orders"><CustomerOrders /></ProtectedRoute>;
    case 'suppliers':
      return <ProtectedRoute module="suppliers"><Suppliers /></ProtectedRoute>;
    case 'expenses':
      return <ProtectedRoute module="expenses"><Expenses /></ProtectedRoute>;
    case 'bank-cash':
      return <ProtectedRoute module="bank_cash"><BankCash /></ProtectedRoute>;
    case 'accounts':
      return <ProtectedRoute module="accounts"><Accounts /></ProtectedRoute>;
    case 'reports':
      return <ProtectedRoute module="reports"><Reports /></ProtectedRoute>;
    case 'settings':
      return (
        <ProtectedRoute module="settings">
          <Settings onBack={goBack} themeMode={themeMode} toggleTheme={toggleTheme} />
        </ProtectedRoute>
      );
    case 'dashboard':
    default:
      return <ProtectedRoute module="dashboard"><Dashboard /></ProtectedRoute>;
  }
});

export default WorkspaceContainer;
