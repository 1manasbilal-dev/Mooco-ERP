import React, { createContext, useContext, useCallback, useMemo, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

// Single-page workspace navigation: one module is shown at a time and the URL is the source of truth.

export interface WorkspaceTab {
  id: string;
  path: string;
  title: string;
  iconName: string;
  module?: string;
  section?: string;
}

export const MODULE_METADATA: Record<string, { title: string; iconName: string; module: string; section?: string }> = {
  'dashboard': { title: 'Dashboard', iconName: 'LayoutDashboard', module: 'dashboard' },
  'pos': { title: 'POS Terminal', iconName: 'Store', module: 'pos', section: 'Counter & Sales' },
  'sales-history': { title: 'Sales History', iconName: 'History', module: 'sales_history', section: 'Counter & Sales' },
  'customer-orders': { title: 'Customer Orders', iconName: 'ClipboardCheck', module: 'customer_orders', section: 'Counter & Sales' },
  'cash-control': { title: 'Shift & Cash Drawer', iconName: 'ClipboardCheck', module: 'cash_control', section: 'Counter & Sales' },
  'purchase': { title: 'Milk Collection', iconName: 'Droplets', module: 'purchase', section: 'Dairy Operations' },
  'purchase-supplies': { title: 'Supplies & Materials', iconName: 'Package', module: 'purchase', section: 'Dairy Operations' },
  'purchase-details': { title: 'Collection Details', iconName: 'ClipboardCheck', module: 'purchase', section: 'Dairy Operations' },
  'allocation': { title: 'Milk Allocation', iconName: 'GitBranch', module: 'allocation', section: 'Dairy Operations' },
  'production': { title: 'Milk Production', iconName: 'Factory', module: 'production', section: 'Dairy Operations' },
  'inventory': { title: 'Inventory Stock', iconName: 'Archive', module: 'inventory', section: 'Dairy Operations' },
  'items': { title: 'Product Catalog', iconName: 'Package', module: 'items', section: 'Dairy Operations' },
  'customers': { title: 'Customers Khata', iconName: 'Users', module: 'customers', section: 'Parties & Ledgers' },
  'suppliers': { title: 'Suppliers Khata', iconName: 'Truck', module: 'suppliers', section: 'Parties & Ledgers' },
  'expenses': { title: 'Expenses & Vendors', iconName: 'Receipt', module: 'expenses', section: 'Parties & Ledgers' },
  'bank-cash': { title: 'Bank & Cash', iconName: 'Wallet', module: 'bank_cash', section: 'Finance & Accounts' },
  'accounts': { title: 'Chart of Accounts', iconName: 'Landmark', module: 'accounts', section: 'Finance & Accounts' },
  'reports': { title: 'Reports & Audits', iconName: 'FileText', module: 'reports', section: 'Finance & Accounts' },
  'settings': { title: 'Settings', iconName: 'Settings', module: 'settings', section: 'System' },
};

interface TabContextType {
  activeTab: WorkspaceTab;
  activeTabId: string;
  openTab: (target: string | Partial<WorkspaceTab>) => void;
  goBack: () => void;
}

const TabContext = createContext<TabContextType | null>(null);

// Keys left behind by the old multi-tab / split-screen workspace.
const LEGACY_STORAGE_KEYS = ['mooco_workspace_tabs', 'mooco_active_tab_id', 'mooco_split_tab_id', 'mooco_is_split_view'];

export const resolveTabStatic = (input: string | Partial<WorkspaceTab>): WorkspaceTab => {
  let rawPath = typeof input === 'string' ? input : (input.path || input.id || 'dashboard');
  if (!rawPath.startsWith('/')) rawPath = '/' + rawPath;

  // e.g. /customers?id=c_123 -> primaryId = 'customers'
  const cleanPath = rawPath.split('?')[0];
  const primaryId = cleanPath.replace(/^\//, '').split('/')[0] || 'dashboard';
  const meta = MODULE_METADATA[primaryId] || {
    title: primaryId.charAt(0).toUpperCase() + primaryId.slice(1).replace(/-/g, ' '),
    iconName: 'LayoutDashboard',
    module: primaryId
  };

  const overrides = typeof input === 'object' ? input : {};
  return {
    id: overrides.id || primaryId,
    path: rawPath,
    title: overrides.title || meta.title,
    iconName: overrides.iconName || meta.iconName,
    module: overrides.module || meta.module,
    section: overrides.section || meta.section
  };
};

export const TabProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    try {
      LEGACY_STORAGE_KEYS.forEach(key => sessionStorage.removeItem(key));
    } catch {}
  }, []);

  const activeTab = useMemo(
    () => resolveTabStatic(`${location.pathname}${location.search}`),
    [location.pathname, location.search]
  );

  const openTab = useCallback((target: string | Partial<WorkspaceTab>) => {
    const next = resolveTabStatic(target);
    if (`${location.pathname}${location.search}` !== next.path) navigate(next.path);
  }, [navigate, location.pathname, location.search]);

  const goBack = useCallback(() => {
    if (window.history.state?.idx > 0) navigate(-1);
    else navigate('/dashboard');
  }, [navigate]);

  const value = useMemo(
    () => ({ activeTab, activeTabId: activeTab.id, openTab, goBack }),
    [activeTab, openTab, goBack]
  );

  return <TabContext.Provider value={value}>{children}</TabContext.Provider>;
};

export const useTabs = (): TabContextType => {
  const context = useContext(TabContext);
  if (!context) {
    throw new Error('useTabs must be used within a TabProvider');
  }
  return context;
};
