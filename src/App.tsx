import React, { Suspense, lazy, useState, useEffect, useCallback, useMemo } from 'react';
import { DairyProvider, useDairy } from './context/DairyContext';
import { ToastProvider } from './context/ToastContext';
import { TabProvider, useTabs } from './context/TabContext';
import Sidebar from './components/Sidebar';
import WorkspaceContainer from './components/WorkspaceContainer';
import ToastContainer from './components/ToastContainer';
import ErrorBoundary from './components/ErrorBoundary';
import SyncStatusBadge from './components/SyncStatusBadge';
import { AppHeader, HeaderUserMenu } from './components/shell/AppHeader';
import { useThemeMode } from './components/shell/preferences';
import { useIdleLock } from './hooks/useIdleLock';

const loadUserSwitcher = () => import('./components/UserSwitcherModal');
const loadCommandPalette = () => import('./components/CommandPalette');
const UserSwitcherModal = lazy(loadUserSwitcher);
const CommandPalette = lazy(() => loadCommandPalette().then(module => ({ default: module.CommandPalette })));

const UserSwitcherHost: React.FC = () => {
  const { isUserSwitcherOpen } = useDairy();
  useIdleLock();
  if (!isUserSwitcherOpen) return null;
  // The lock screen paints its own opaque backdrop as soon as its small chunk arrives.
  return <Suspense fallback={<div className="fixed inset-0 z-[250] bg-canvas" data-lock-screen aria-busy="true" />}>
    <UserSwitcherModal />
  </Suspense>;
};

const AppContent: React.FC = () => {
  const { activeTab, activeTabId, openTab } = useTabs();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const { themeMode, toggleTheme } = useThemeMode();

  const openSidebar = useCallback(() => setIsSidebarOpen(true), []);
  const closeSidebar = useCallback(() => setIsSidebarOpen(false), []);
  const openPalette = useCallback(() => setIsCommandPaletteOpen(true), []);
  const closePalette = useCallback(() => setIsCommandPaletteOpen(false), []);
  const goHome = useCallback(() => openTab('dashboard'), [openTab]);
  const syncBadge = useMemo(() => <SyncStatusBadge />, []);
  const userMenu = useMemo(() => <HeaderUserMenu themeMode={themeMode} onToggleTheme={toggleTheme} />, [themeMode, toggleTheme]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'k') return;
      // Never on top of the lock screen: it would let a locked terminal open pages.
      if (document.querySelector('[data-lock-screen]')) return;
      const activeEl = document.activeElement as HTMLElement | null;
      const isEditingInPosBilling = activeEl && (
        activeEl.tagName === 'INPUT' ||
        activeEl.tagName === 'TEXTAREA' ||
        activeEl.isContentEditable
      ) && Boolean(activeEl.closest('.pos-cart-list, .pos-quick-dialog, [role="dialog"], [aria-modal="true"], .pos-checkout-section'));

      if (isEditingInPosBilling) {
        return;
      }

      e.preventDefault();
      setIsCommandPaletteOpen(prev => !prev);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Fetch the quick-search and lock-screen chunks once the app is idle, so they open instantly later.
  useEffect(() => {
    const preload = () => { void loadCommandPalette().catch(() => {}); void loadUserSwitcher().catch(() => {}); };
    if ('requestIdleCallback' in window) {
      const id = window.requestIdleCallback(preload, { timeout: 4000 });
      return () => window.cancelIdleCallback(id);
    }
    const timer = setTimeout(preload, 2500);
    return () => clearTimeout(timer);
  }, []);

  return (
    <>
      <ToastContainer />
      <UserSwitcherHost />
      {isCommandPaletteOpen && (
        <Suspense fallback={null}>
          <CommandPalette
            isOpen={isCommandPaletteOpen}
            onClose={closePalette}
            toggleTheme={toggleTheme}
            themeMode={themeMode}
          />
        </Suspense>
      )}

      <div data-workspace={activeTabId} className="mooco-app mooco-shell flex h-[100dvh] w-full overflow-hidden bg-canvas font-sans text-fg">
        <a href="#main-content" className="sr-only z-[300] rounded-control bg-surface px-4 py-2 text-sm font-semibold text-fg shadow-e2 focus:not-sr-only focus:fixed focus:left-3 focus:top-3">
          Skip to content
        </a>
        <Sidebar
          isOpen={isSidebarOpen}
          onClose={closeSidebar}
        />

        <div data-shell-content className="relative flex h-full min-w-0 flex-1 flex-col overflow-hidden">
          <AppHeader
            title={activeTab.title}
            section={activeTab.section}
            isSidebarOpen={isSidebarOpen}
            onOpenSidebar={openSidebar}
            themeMode={themeMode}
            onToggleTheme={toggleTheme}
            onOpenPalette={openPalette}
            onHome={goHome}
            status={syncBadge}
            userMenu={userMenu}
          />

          <main id="main-content" tabIndex={-1} className="relative flex min-h-0 flex-1 flex-col overflow-hidden outline-none">
            <WorkspaceContainer themeMode={themeMode} toggleTheme={toggleTheme} />
          </main>
        </div>
      </div>
    </>
  );
};

// Design-system gallery for development only; the import is dropped from production builds.
const UiGallery = import.meta.env.DEV ? lazy(() => import('./dev/UiGallery')) : null;

const App: React.FC = () => {
  if (UiGallery && window.location.pathname === '/__ui') {
    return <Suspense fallback={null}><UiGallery /></Suspense>;
  }
  return (
    <ErrorBoundary>
      <ToastProvider>
        <DairyProvider>
          <TabProvider>
            <AppContent />
          </TabProvider>
        </DairyProvider>
      </ToastProvider>
    </ErrorBoundary>
  );
};

export default App;
