import React, { Suspense, lazy, useState, useEffect } from 'react';
import { DairyProvider, useDairy } from './context/DairyContext';
import { ToastProvider } from './context/ToastContext';
import { TabProvider, useTabs } from './context/TabContext';
import Sidebar from './components/Sidebar';
import WorkspaceContainer from './components/WorkspaceContainer';
import ToastContainer from './components/ToastContainer';
import ErrorBoundary from './components/ErrorBoundary';
import SyncStatusBadge from './components/SyncStatusBadge';
import PageLoadingFallback from './components/PageLoadingFallback';
import { Search, Menu, Sun, Moon, Lock, LogOut, ChevronDown, ChevronRight, Home, Minus, Plus } from 'lucide-react';
import { useIdleLock } from './hooks/useIdleLock';

const UserSwitcherModal = lazy(() => import('./components/UserSwitcherModal'));
const CommandPalette = lazy(() => import('./components/CommandPalette').then(module => ({ default: module.CommandPalette })));

const UserSwitcherHost: React.FC = () => {
  const { isUserSwitcherOpen } = useDairy();
  useIdleLock();
  if (!isUserSwitcherOpen) return null;
  return <Suspense fallback={<PageLoadingFallback variant="overlay" message="Opening secure user access" submessage="Getting your sign-in ready" />}>
    <UserSwitcherModal />
  </Suspense>;
};

const HeaderUserButton: React.FC = () => {
  const { currentUser, currentRole, logoutUser, lockTerminalNow, setIsUserSwitcherOpen } = useDairy();
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const initials = currentUser?.name ? currentUser.name.slice(0, 2).toUpperCase() : 'OW';
  // Screen size is a per-device choice (a POS touch screen vs an office laptop), so it lives here.
  const [zoom, setZoom] = useState<number>(() => {
    const saved = parseInt(localStorage.getItem('app_zoom_scale') || '', 10);
    return saved >= 80 && saved <= 150 ? saved : 100;
  });
  const changeZoom = (step: number) => {
    const next = Math.min(150, Math.max(80, zoom + step));
    setZoom(next);
    localStorage.setItem('app_zoom_scale', String(next));
    document.documentElement.style.fontSize = `${(next / 100) * 16}px`;
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen(prev => !prev)}
        className="flex items-center gap-2 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700/60 border border-slate-200 dark:border-slate-700 rounded-xl p-1.5 shadow-xs transition-all cursor-pointer"
        title="User profile & options"
      >
        <div className="w-7 h-7 rounded-lg bg-lime-100 dark:bg-lime-900/50 text-lime-800 dark:text-lime-300 font-black text-xs flex items-center justify-center">
          {initials}
        </div>
        <div className="flex flex-col text-left hidden sm:block min-w-0 max-w-[110px]">
          <span className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate leading-tight block">
            {currentUser?.name || 'Admin'}
          </span>
          <span className="text-[10px] text-slate-400 dark:text-slate-500 font-semibold truncate leading-none block">
            {currentRole?.name || 'Super Admin'}
          </span>
        </div>
        <ChevronDown size={14} className={`text-slate-400 transition-transform duration-150 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute right-0 top-[calc(100%+0.35rem)] w-52 p-2 bg-white dark:bg-slate-850 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-xl z-50 space-y-1 backdrop-blur-md animate-in fade-in zoom-in-95 duration-150">
          <div className="flex items-center justify-between gap-2 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200">
            <span>Screen size</span>
            <div className="flex items-center gap-1">
              <button type="button" aria-label="Screen chhoti karein" disabled={zoom <= 80} onClick={() => changeZoom(-10)} className="p-1 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 cursor-pointer"><Minus size={12} /></button>
              <span className="w-10 text-center font-mono text-[11px]">{zoom}%</span>
              <button type="button" aria-label="Screen bari karein" disabled={zoom >= 150} onClick={() => changeZoom(10)} className="p-1 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 cursor-pointer"><Plus size={12} /></button>
            </div>
          </div>
          <div className="h-px bg-slate-100 dark:bg-slate-800 mx-2" />
          <button
            type="button"
            onClick={() => {
              setIsOpen(false);
              // A real lock: the screen only opens again with a PIN (not with the close button).
              // Offline the PIN cannot be checked, so (like the idle lock) it stays a switcher.
              if (navigator.onLine) lockTerminalNow();
              else setIsUserSwitcherOpen(true);
            }}
            className="flex w-full items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <Lock size={14} className="text-slate-400 shrink-0" />
            <span>Switch User / Lock</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setIsOpen(false);
              logoutUser();
            }}
            className="flex w-full items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-bold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors cursor-pointer"
          >
            <LogOut size={14} className="text-rose-500 shrink-0" />
            <span>Logout / Sign Out</span>
          </button>
        </div>
      )}
    </div>
  );
};

const AppContent: React.FC = () => {
  const { activeTab, activeTabId, openTab } = useTabs();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [themeMode, setThemeMode] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem('app_theme');
    if (saved) return saved as 'light' | 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);

  const toggleTheme = () => {
    if (themeMode === 'light') {
      setThemeMode('dark');
      localStorage.setItem('app_theme', 'dark');
      document.documentElement.classList.add('dark');
    } else {
      setThemeMode('light');
      localStorage.setItem('app_theme', 'light');
      document.documentElement.classList.remove('dark');
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
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
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    const savedScale = localStorage.getItem('app_zoom_scale');
    if (savedScale) {
      const scale = parseInt(savedScale, 10);
      if (scale >= 80 && scale <= 250) {
        document.documentElement.style.fontSize = `${(scale / 100) * 16}px`;
      }
    }

    const savedTheme = localStorage.getItem('app_theme');
    const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (savedTheme === 'dark' || (!savedTheme && systemDark)) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, []);

  return (
    <>
      <ToastContainer />
      <UserSwitcherHost />
      {isCommandPaletteOpen && (
        <Suspense fallback={<PageLoadingFallback variant="overlay" message="Opening quick search" submessage="Your next action, a little closer" />}>
        <CommandPalette 
          isOpen={isCommandPaletteOpen} 
          onClose={() => setIsCommandPaletteOpen(false)} 
          toggleTheme={toggleTheme} 
          themeMode={themeMode} 
        />
        </Suspense>
      )}

      <div data-workspace={activeTabId} className="mooco-app flex h-[100dvh] w-full font-sans bg-slate-50 dark:bg-slate-950 overflow-hidden">
        <Sidebar 
          isOpen={isSidebarOpen} 
          onClose={() => setIsSidebarOpen(false)} 
        />

        <div data-sidebar-content className="flex-1 min-w-0 flex flex-col h-full overflow-hidden relative">
          <div className="absolute top-0 left-0 w-full h-64 bg-gradient-to-b from-slate-200 dark:from-slate-900 to-slate-50 dark:to-slate-950 -z-10"></div>

          <header className="h-16 md:h-18 flex items-center justify-between px-3 sm:px-4 md:px-6 lg:px-8 pt-2 md:pt-3 pb-2 z-20 shrink-0 relative gap-2 border-b border-slate-200/60 dark:border-slate-800/80 bg-white/70 dark:bg-slate-900/70 backdrop-blur-md">
            <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1 sm:flex-initial">
              <button 
                onClick={() => setIsSidebarOpen(true)}
                className="md:hidden p-2 sm:p-2.5 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/60 shadow-xs cursor-pointer transition-all shrink-0"
                title="Open Navigation Menu" aria-label="Open navigation menu" aria-expanded={isSidebarOpen} aria-controls="mooco-sidebar"
              >
                <Menu size={19} />
              </button>
              
              <div className="flex flex-col min-w-0">
                <nav aria-label="Breadcrumb" className="hidden sm:flex items-center gap-1 text-[11px] font-medium text-slate-500 dark:text-slate-400 min-w-0">
                  <button
                    type="button"
                    onClick={() => openTab('dashboard')}
                    className="flex items-center gap-1 hover:text-lime-700 dark:hover:text-lime-400 transition-colors cursor-pointer shrink-0"
                  >
                    <Home size={12} aria-hidden="true" />
                    <span>Mooco ERP</span>
                  </button>
                  {activeTab.section && (
                    <>
                      <ChevronRight size={12} className="text-slate-300 dark:text-slate-600 shrink-0" aria-hidden="true" />
                      <span className="truncate">{activeTab.section}</span>
                    </>
                  )}
                </nav>
                <h1 className="text-sm sm:text-base lg:text-lg font-bold text-slate-900 dark:text-slate-50 tracking-tight truncate leading-tight">
                  {activeTab.title}
                </h1>
              </div>
            </div>
            
            <div className="flex items-center gap-1.5 sm:gap-2 md:gap-3 shrink-0">
              <SyncStatusBadge />

              <HeaderUserButton />

              <button 
                type="button"
                onClick={() => setIsCommandPaletteOpen(true)}
                className="flex items-center bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700/80 border border-slate-200 dark:border-slate-700 rounded-xl p-2 sm:px-3 sm:py-2 md:px-3 shadow-xs hover:border-lime-500/50 transition-all cursor-pointer active:scale-95 text-left"
                title="Quick Search & Command Palette (Ctrl+K)" aria-label="Quick search"
              >
                <Search size={16} className="text-slate-400 lg:mr-2 shrink-0"/>
                <span className="hidden lg:inline text-xs font-medium text-slate-400 w-24 xl:w-32 truncate">
                  Quick search...
                </span>
                <kbd className="hidden xl:inline-block text-[10px] font-semibold text-slate-400 dark:text-slate-500 bg-slate-100 dark:bg-slate-700 px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-600 ml-1">
                  {/Mac|iPhone|iPad/i.test(typeof navigator !== 'undefined' ? navigator.platform || navigator.userAgent : '') ? '⌘K' : 'Ctrl K'}
                </kbd>
              </button>

              <button 
                onClick={toggleTheme} 
                className="flex items-center gap-1.5 p-2 sm:px-3 sm:py-2 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700/80 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-600 dark:text-slate-300 shadow-xs transition-all hover:border-lime-400/50 cursor-pointer active:scale-95 shrink-0"
                title={themeMode === 'light' ? 'Switch to Dark Theme' : 'Switch to Light Theme'}
              >
                {themeMode === 'light' ? (
                  <>
                    <Moon size={16} className="text-slate-600 dark:text-slate-300 transition-transform duration-200 rotate-0" />
                    <span className="text-xs font-semibold hidden md:inline">Dark</span>
                  </>
                ) : (
                  <>
                    <Sun size={16} className="text-amber-400 transition-transform duration-200 rotate-90" />
                    <span className="text-xs font-semibold hidden md:inline text-amber-300">Light</span>
                  </>
                )}
              </button>
            </div>
          </header>

          <main className="flex-1 flex flex-col min-h-0 overflow-hidden relative">
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
