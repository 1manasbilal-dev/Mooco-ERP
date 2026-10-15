import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

export interface WorkspaceTab {
  id: string;
  path: string;
  title: string;
  iconName: string;
  closable?: boolean;
  module?: string;
  badge?: string | number;
}

export const MODULE_METADATA: Record<string, { title: string; iconName: string; module: string }> = {
  'dashboard': { title: 'Dashboard', iconName: 'LayoutDashboard', module: 'dashboard' },
  'pos': { title: 'POS Terminal', iconName: 'Store', module: 'pos' },
  'sales-history': { title: 'Sales History', iconName: 'History', module: 'sales_history' },
  'customer-orders': { title: 'Customer Orders', iconName: 'ClipboardCheck', module: 'customer_orders' },
  'cash-control': { title: 'Shift & Cash Drawer', iconName: 'ClipboardCheck', module: 'cash_control' },
  'purchase': { title: 'Milk Collection', iconName: 'Droplets', module: 'purchase' },
  'purchase-supplies': { title: 'Supplies & Materials', iconName: 'Package', module: 'purchase' },
  'purchase-details': { title: 'Collection Details', iconName: 'ClipboardCheck', module: 'purchase' },
  'allocation': { title: 'Milk Allocation', iconName: 'GitBranch', module: 'allocation' },
  'production': { title: 'Milk Production', iconName: 'Factory', module: 'production' },
  'inventory': { title: 'Inventory Stock', iconName: 'Archive', module: 'inventory' },
  'items': { title: 'Product Catalog', iconName: 'Package', module: 'items' },
  'customers': { title: 'Customers Khata', iconName: 'Users', module: 'customers' },
  'suppliers': { title: 'Suppliers Khata', iconName: 'Truck', module: 'suppliers' },
  'expenses': { title: 'Expenses & Vendors', iconName: 'Receipt', module: 'expenses' },
  'bank-cash': { title: 'Bank & Cash', iconName: 'Wallet', module: 'bank_cash' },
  'accounts': { title: 'Chart of Accounts', iconName: 'Landmark', module: 'accounts' },
  'reports': { title: 'Reports & Audits', iconName: 'FileText', module: 'reports' },
  'settings': { title: 'Settings', iconName: 'Settings', module: 'settings' },
};

export const DEFAULT_DASHBOARD_TAB: WorkspaceTab = {
  id: 'dashboard',
  path: '/dashboard',
  title: 'Dashboard',
  iconName: 'LayoutDashboard',
  closable: false,
  module: 'dashboard'
};

interface TabContextType {
  tabs: WorkspaceTab[];
  activeTabId: string;
  splitTabId: string | null;
  isSplitView: boolean;
  openTab: (target: string | Partial<WorkspaceTab>) => void;
  closeTab: (id: string) => void;
  closeOtherTabs: (id: string) => void;
  closeAllTabs: () => void;
  setActiveTabId: (id: string) => void;
  toggleSplitView: () => void;
  setSplitTabId: (id: string | null) => void;
  swapSplitTabs: () => void;
  reorderTabs: (newTabs: WorkspaceTab[]) => void;
}

const TabContext = createContext<TabContextType | null>(null);

const STORAGE_KEY_TABS = 'mooco_workspace_tabs';
const STORAGE_KEY_ACTIVE = 'mooco_active_tab_id';
const STORAGE_KEY_SPLIT = 'mooco_split_tab_id';
const STORAGE_KEY_SPLIT_VIEW = 'mooco_is_split_view';

export const resolveTabStatic = (input: string | Partial<WorkspaceTab>): WorkspaceTab => {
  let rawPath = typeof input === 'string' ? input : (input.path || input.id || 'dashboard');
  if (!rawPath.startsWith('/')) rawPath = '/' + rawPath;

  // e.g. /customers?id=c_123 -> primaryId = 'customers'
  const cleanPath = rawPath.split('?')[0];
  const parts = cleanPath.replace(/^\//, '').split('/');
  const primaryId = parts[0] || 'dashboard';
  const meta = MODULE_METADATA[primaryId] || {
    title: primaryId.charAt(0).toUpperCase() + primaryId.slice(1).replace(/-/g, ' '),
    iconName: 'LayoutDashboard',
    module: primaryId
  };

  const isDashboard = primaryId === 'dashboard';

  if (typeof input === 'object') {
    return {
      id: input.id || primaryId,
      path: rawPath,
      title: input.title || meta.title,
      iconName: input.iconName || meta.iconName,
      closable: input.closable !== undefined ? input.closable : !isDashboard,
      module: input.module || meta.module,
      badge: input.badge
    };
  }

  return {
    id: primaryId,
    path: rawPath,
    title: meta.title,
    iconName: meta.iconName,
    closable: !isDashboard,
    module: meta.module
  };
};

export const TabProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const navigate = useNavigate();
  const location = useLocation();

  // 1. Initial State: URL is authoritative on reload/direct entry
  const currentPathSlug = location.pathname.replace(/^\//, '').split('/')[0] || 'dashboard';
  const fullInitialPath = `${location.pathname}${location.search}`;

  const [tabs, setTabs] = useState<WorkspaceTab[]>(() => {
    let initialTabs: WorkspaceTab[] = [DEFAULT_DASHBOARD_TAB];
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY_TABS);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const clean = parsed.filter((t: any) => t.id !== 'closing-sale');
          if (clean.length > 0) initialTabs = clean;
        }
      }
    } catch (e) {
      console.warn('Failed to parse saved tabs', e);
    }

    if (currentPathSlug && currentPathSlug !== 'closing-sale') {
      const existingIdx = initialTabs.findIndex(t => t.id === currentPathSlug);
      const currentTabObj = resolveTabStatic(fullInitialPath);
      if (existingIdx >= 0) {
        initialTabs[existingIdx] = { ...initialTabs[existingIdx], path: fullInitialPath };
      } else {
        initialTabs.push(currentTabObj);
      }
    }
    return initialTabs;
  });

  const [activeTabId, setActiveTabIdState] = useState<string>(() => {
    if (currentPathSlug && currentPathSlug !== 'closing-sale') {
      return currentPathSlug;
    }
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY_ACTIVE);
      if (saved && saved !== 'closing-sale') return saved;
    } catch {}
    return 'dashboard';
  });

  const [isSplitView, setIsSplitViewState] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem(STORAGE_KEY_SPLIT_VIEW) === 'true';
    } catch {
      return false;
    }
  });

  const [splitTabId, setSplitTabIdState] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem(STORAGE_KEY_SPLIT);
    } catch {
      return null;
    }
  });

  // 2. Persist state changes in sessionStorage
  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY_TABS, JSON.stringify(tabs));
    } catch {}
  }, [tabs]);

  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY_ACTIVE, activeTabId);
    } catch {}
  }, [activeTabId]);

  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY_SPLIT_VIEW, String(isSplitView));
    } catch {}
  }, [isSplitView]);

  useEffect(() => {
    try {
      if (splitTabId) {
        sessionStorage.setItem(STORAGE_KEY_SPLIT, splitTabId);
      } else {
        sessionStorage.removeItem(STORAGE_KEY_SPLIT);
      }
    } catch {}
  }, [splitTabId]);

  // 3. Helper to build a WorkspaceTab from path/id
  const resolveTab = useCallback((input: string | Partial<WorkspaceTab>): WorkspaceTab => {
    return resolveTabStatic(input);
  }, []);

  // 4. Open or Focus a Tab
  const openTab = useCallback((target: string | Partial<WorkspaceTab>) => {
    const tabObj = resolveTab(target);

    setTabs(prevTabs => {
      const existingIdx = prevTabs.findIndex(t => t.id === tabObj.id);
      if (existingIdx >= 0) {
        // Update path if different (e.g. subtab change)
        if (prevTabs[existingIdx].path !== tabObj.path) {
          const updated = [...prevTabs];
          updated[existingIdx] = { ...updated[existingIdx], path: tabObj.path };
          return updated;
        }
        return prevTabs;
      }
      return [...prevTabs, tabObj];
    });

    setActiveTabIdState(tabObj.id);
    navigate(tabObj.path);
  }, [navigate, resolveTab]);

  // 5. Set active tab with navigation
  const setActiveTabId = useCallback((id: string) => {
    const tab = tabs.find(t => t.id === id);
    if (tab) {
      setActiveTabIdState(id);
      navigate(tab.path);
    }
  }, [tabs, navigate]);

  // 6. Close a Tab
  const closeTab = useCallback((id: string) => {
    setTabs(prevTabs => {
      const tabToClose = prevTabs.find(t => t.id === id);
      if (!tabToClose) return prevTabs;

      const closingIndex = prevTabs.findIndex(t => t.id === id);
      const remaining = prevTabs.filter(t => t.id !== id);

      // If no tabs left, reset to dashboard
      if (remaining.length === 0) {
        setActiveTabIdState(DEFAULT_DASHBOARD_TAB.id);
        navigate(DEFAULT_DASHBOARD_TAB.path);
        return [DEFAULT_DASHBOARD_TAB];
      }

      // If we're closing the active tab, switch to nearest tab
      if (activeTabId === id) {
        const nextIndex = Math.min(closingIndex, remaining.length - 1);
        const nextTab = remaining[nextIndex];
        setActiveTabIdState(nextTab.id);
        navigate(nextTab.path);
      }

      // If we're closing the split tab, handle split state
      if (splitTabId === id) {
        const otherOpen = remaining.find(t => t.id !== activeTabId);
        if (otherOpen) {
          setSplitTabIdState(otherOpen.id);
        } else {
          setIsSplitViewState(false);
          setSplitTabIdState(null);
        }
      }

      return remaining;
    });
  }, [activeTabId, splitTabId, navigate]);

  // 7. Close other tabs
  const closeOtherTabs = useCallback((id: string) => {
    setTabs(prev => {
      const keep = prev.filter(t => t.id === id || t.id === 'dashboard');
      return keep.length > 0 ? keep : prev;
    });
    setActiveTabId(id);
  }, [setActiveTabId]);

  // 8. Close all tabs
  const closeAllTabs = useCallback(() => {
    setTabs([DEFAULT_DASHBOARD_TAB]);
    setActiveTabIdState('dashboard');
    setIsSplitViewState(false);
    setSplitTabIdState(null);
    navigate('/dashboard');
  }, [navigate]);

  // 9. Split View Controls
  const toggleSplitView = useCallback(() => {
    setIsSplitViewState(prev => {
      const next = !prev;
      if (next && !splitTabId) {
        // Pick an alternate open tab if available
        const alt = tabs.find(t => t.id !== activeTabId);
        if (alt) {
          setSplitTabIdState(alt.id);
        }
      }
      return next;
    });
  }, [splitTabId, tabs, activeTabId]);

  const setSplitTabId = useCallback((id: string | null) => {
    setSplitTabIdState(id);
    if (id) {
      setIsSplitViewState(true);
    }
  }, []);

  const swapSplitTabs = useCallback(() => {
    if (!splitTabId) return;
    const oldActive = activeTabId;
    const oldSplit = splitTabId;
    setActiveTabIdState(oldSplit);
    setSplitTabIdState(oldActive);
    const splitTabObj = tabs.find(t => t.id === oldSplit);
    if (splitTabObj) {
      navigate(splitTabObj.path);
    }
  }, [splitTabId, activeTabId, tabs, navigate]);

  const reorderTabs = useCallback((newTabs: WorkspaceTab[]) => {
    setTabs(newTabs);
  }, []);

  // 10. Sync when browser back/forward buttons or direct links are hit
  useEffect(() => {
    const cleanPath = location.pathname.replace(/^\//, '').split('?')[0];
    const pathSlug = cleanPath.split('/')[0] || 'dashboard';
    if (!pathSlug) return;

    const fullCurrentPath = `${location.pathname}${location.search}`;

    setTabs(prevTabs => {
      const existingIdx = prevTabs.findIndex(t => t.id === pathSlug);
      if (existingIdx === -1) {
        const newTab = resolveTab(fullCurrentPath);
        return [...prevTabs, newTab];
      }
      if (prevTabs[existingIdx].path !== fullCurrentPath) {
        const updated = [...prevTabs];
        updated[existingIdx] = { ...updated[existingIdx], path: fullCurrentPath };
        return updated;
      }
      return prevTabs;
    });

    setActiveTabIdState(pathSlug);
  }, [location.pathname, location.search, resolveTab]);

  return (
    <TabContext.Provider
      value={{
        tabs,
        activeTabId,
        splitTabId,
        isSplitView,
        openTab,
        closeTab,
        closeOtherTabs,
        closeAllTabs,
        setActiveTabId,
        toggleSplitView,
        setSplitTabId,
        swapSplitTabs,
        reorderTabs
      }}
    >
      {children}
    </TabContext.Provider>
  );
};

export const useTabs = (): TabContextType => {
  const context = useContext(TabContext);
  if (!context) {
    throw new Error('useTabs must be used within a TabProvider');
  }
  return context;
};
