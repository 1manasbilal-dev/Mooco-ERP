import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useTabs, WorkspaceTab, MODULE_METADATA } from '../context/TabContext';
import { useDairy } from '../context/DairyContext';
import { PermissionModule } from '../types';
import {
  LayoutDashboard,
  Store,
  Calculator,
  History,
  ClipboardCheck,
  ShoppingCart,
  Droplets,
  GitBranch,
  Factory,
  Archive,
  Package,
  Users,
  Truck,
  Receipt,
  Wallet,
  Landmark,
  FileText,
  Settings,
  Plus,
  X,
  Columns2,
  ChevronLeft,
  ChevronRight,
  MoreVertical,
  ArrowLeftRight,
  Maximize2
} from 'lucide-react';

// Icon Map Resolver
const ICON_MAP: Record<string, React.ElementType> = {
  LayoutDashboard,
  Store,
  Calculator,
  History,
  ClipboardCheck,
  ShoppingCart,
  Droplets,
  GitBranch,
  Factory,
  Archive,
  Package,
  Users,
  Truck,
  Receipt,
  Wallet,
  Landmark,
  FileText,
  Settings
};

export const TabBar: React.FC = () => {
  const {
    tabs,
    activeTabId,
    splitTabId,
    isSplitView,
    setActiveTabId,
    openTab,
    closeTab,
    closeOtherTabs,
    closeAllTabs,
    toggleSplitView,
    swapSplitTabs
  } = useTabs();

  const { hasPermission } = useDairy();

  const [isNewTabMenuOpen, setIsNewTabMenuOpen] = useState(false);
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const newTabMenuRef = useRef<HTMLDivElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);

  // Close dropdowns on outside click
  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (newTabMenuRef.current && !newTabMenuRef.current.contains(e.target as Node)) {
        setIsNewTabMenuOpen(false);
      }
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) {
        setIsMoreMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  // Horizontal scroll controls
  const scrollTabs = (direction: 'left' | 'right') => {
    if (scrollContainerRef.current) {
      const scrollAmount = direction === 'left' ? -220 : 220;
      scrollContainerRef.current.scrollBy({ left: scrollAmount, behavior: 'smooth' });
    }
  };

  // Scroll active tab into view whenever it changes
  useEffect(() => {
    if (scrollContainerRef.current) {
      const activeEl = scrollContainerRef.current.querySelector<HTMLElement>(`[data-tab-id="${activeTabId}"]`);
      if (activeEl) {
        activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
      }
    }
  }, [activeTabId]);

  // Modules categorized for the "+ New Tab" Quick Launcher
  const availableModules = useMemo(() => {
    const sections = [
      {
        section: 'Counter & Sales',
        items: ['pos', 'sales-history', 'cash-control']
      },
      {
        section: 'Dairy Operations',
        items: ['purchase', 'purchase-supplies', 'purchase-details', 'allocation', 'production', 'inventory', 'items']
      },
      {
        section: 'Parties & Ledgers',
        items: ['customers', 'suppliers', 'expenses']
      },
      {
        section: 'Finance & Accounts',
        items: ['bank-cash', 'accounts', 'reports', 'settings']
      }
    ];

    return sections.map(sec => ({
      section: sec.section,
      items: sec.items.filter(id => {
        const meta = MODULE_METADATA[id];
        if (!meta) return false;
        return hasPermission(meta.module as PermissionModule);
      })
    })).filter(sec => sec.items.length > 0);
  }, [hasPermission]);

  return (
    <div className="w-full bg-slate-100/90 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-2 sm:px-4 md:px-8 py-1.5 flex items-center justify-between gap-2 z-10 shrink-0 select-none backdrop-blur-xs">
      {/* Left: Scroll Left Chevron if needed */}
      <div className="flex items-center min-w-0 flex-1 gap-1">
        <button
          type="button"
          onClick={() => scrollTabs('left')}
          className="hidden sm:flex p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer shrink-0"
          title="Scroll tabs left"
        >
          <ChevronLeft size={15} />
        </button>

        {/* Horizontal Tabs Strip */}
        <div
          ref={scrollContainerRef}
          className="flex items-center gap-1.5 overflow-x-auto scrollbar-none py-0.5 flex-1 min-w-0"
        >
          {tabs.map(tab => {
            const isActive = tab.id === activeTabId;
            const isSplitActive = isSplitView && tab.id === splitTabId;
            const Icon = ICON_MAP[tab.iconName] || LayoutDashboard;

            return (
              <div
                key={tab.id}
                data-tab-id={tab.id}
                onMouseDown={(e) => {
                  // Middle-click to close tab (browser style!)
                  if (e.button === 1 && tab.closable) {
                    e.preventDefault();
                    closeTab(tab.id);
                  }
                }}
                onClick={() => setActiveTabId(tab.id)}
                className={`group relative flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold cursor-pointer transition-all shrink-0 max-w-[200px] sm:max-w-[240px] border ${
                  isActive
                    ? 'bg-white dark:bg-slate-850 text-slate-900 dark:text-white border-slate-200/90 dark:border-slate-700 shadow-xs'
                    : isSplitActive
                    ? 'bg-indigo-50/80 dark:bg-indigo-950/40 text-indigo-900 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800/80 shadow-2xs'
                    : 'bg-slate-200/50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-400 border-transparent hover:bg-white/70 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
                title={`${tab.title} (${tab.path})`}
              >
                {/* Active Indicator Strip */}
                {isActive && (
                  <span className="absolute bottom-0 left-3 right-3 h-[2.5px] bg-lime-500 rounded-full"></span>
                )}
                {isSplitActive && !isActive && (
                  <span className="absolute bottom-0 left-3 right-3 h-[2px] bg-indigo-500 rounded-full"></span>
                )}

                {/* Tab Icon */}
                <Icon
                  size={14}
                  className={`shrink-0 ${
                    isActive
                      ? 'text-lime-600 dark:text-lime-400'
                      : isSplitActive
                      ? 'text-indigo-600 dark:text-indigo-400'
                      : 'text-slate-400 dark:text-slate-500 group-hover:text-slate-600'
                  }`}
                />

                {/* Tab Title */}
                <span className="truncate">{tab.title}</span>

                {/* Secondary Window Badge */}
                {isSplitActive && !isActive && (
                  <span className="text-[9px] font-black uppercase px-1 py-0.2 bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300 rounded shrink-0">
                    Win 2
                  </span>
                )}

                {/* Close Button (✕) */}
                {tab.closable && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      closeTab(tab.id);
                    }}
                    className="ml-1 p-0.5 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors cursor-pointer shrink-0"
                    title={`Close ${tab.title}`}
                  >
                    <X size={13} />
                  </button>
                )}
              </div>
            );
          })}

          {/* "+ New Tab" Quick Launcher Button */}
          <div ref={newTabMenuRef} className="relative shrink-0">
            <button
              type="button"
              onClick={() => setIsNewTabMenuOpen(prev => !prev)}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-slate-200/60 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-lime-500 hover:text-white dark:hover:bg-lime-600 dark:hover:text-white transition-all text-xs font-bold shadow-2xs cursor-pointer active:scale-95"
              title="Open a new window / tab"
            >
              <Plus size={14} />
              <span className="hidden sm:inline">New Tab</span>
            </button>

            {/* Quick Launcher Dropdown Menu */}
            {isNewTabMenuOpen && (
              <div className="absolute left-0 top-[calc(100%+0.4rem)] w-64 max-h-96 overflow-y-auto bg-white dark:bg-slate-850 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-2xl p-2.5 z-50 animate-in fade-in zoom-in-95 duration-150 space-y-2.5 scrollbar-thin">
                <div className="flex items-center justify-between pb-1.5 border-b border-slate-100 dark:border-slate-800">
                  <span className="text-[11px] font-black uppercase tracking-wider text-slate-400">
                    Open Window / Tab
                  </span>
                  <span className="text-[10px] bg-slate-100 dark:bg-slate-800 text-slate-500 px-1.5 py-0.2 rounded font-mono">
                    Ctrl+Click
                  </span>
                </div>

                {availableModules.map(sec => (
                  <div key={sec.section} className="space-y-1">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-2 pt-1">
                      {sec.section}
                    </p>
                    {sec.items.map(id => {
                      const meta = MODULE_METADATA[id];
                      const Icon = ICON_MAP[meta.iconName] || LayoutDashboard;
                      const isOpen = tabs.some(t => t.id === id);

                      return (
                        <button
                          key={id}
                          type="button"
                          onClick={() => {
                            openTab(id);
                            setIsNewTabMenuOpen(false);
                          }}
                          className={`w-full flex items-center justify-between px-2.5 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                            isOpen
                              ? 'bg-lime-50 dark:bg-lime-950/40 text-lime-800 dark:text-lime-300 font-bold'
                              : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                          }`}
                        >
                          <div className="flex items-center gap-2 truncate">
                            <Icon size={14} className={isOpen ? 'text-lime-600 dark:text-lime-400' : 'text-slate-400'} />
                            <span className="truncate">{meta.title}</span>
                          </div>
                          {isOpen && (
                            <span className="text-[9px] px-1.5 py-0.2 rounded bg-lime-200/80 dark:bg-lime-900 text-lime-900 dark:text-lime-200 font-bold">
                              Active
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={() => scrollTabs('right')}
          className="hidden sm:flex p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer shrink-0"
          title="Scroll tabs right"
        >
          <ChevronRight size={15} />
        </button>
      </div>

      {/* Right: Split View (Dual Window) Toggle & More Actions */}
      <div className="flex items-center gap-1.5 shrink-0">
        {/* Split Screen / Dual Window Toggle */}
        <button
          type="button"
          onClick={toggleSplitView}
          className={`flex items-center gap-1 px-2.5 py-1.5 rounded-xl border text-xs font-bold transition-all cursor-pointer active:scale-95 ${
            isSplitView
              ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
              : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-indigo-400'
          }`}
          title={isSplitView ? 'Close Split Screen (Single Window)' : 'Open 2 Windows Side-by-Side (Split Screen)'}
        >
          <Columns2 size={14} className={isSplitView ? 'text-white' : 'text-indigo-500'} />
          <span className="hidden lg:inline">{isSplitView ? 'Dual Screen: ON' : 'Split 2 Windows'}</span>
        </button>

        {/* Swap Windows button (Only when Split View is active) */}
        {isSplitView && (
          <button
            type="button"
            onClick={swapSplitTabs}
            className="p-1.5 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-xl border border-slate-200 dark:border-slate-700 transition-colors cursor-pointer"
            title="Swap Left & Right Windows"
          >
            <ArrowLeftRight size={14} />
          </button>
        )}

        {/* More Tab Operations Dropdown */}
        <div ref={moreMenuRef} className="relative">
          <button
            type="button"
            onClick={() => setIsMoreMenuOpen(prev => !prev)}
            className="p-1.5 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400 rounded-xl border border-slate-200 dark:border-slate-700 transition-colors cursor-pointer"
            title="Tab workspace options"
          >
            <MoreVertical size={14} />
          </button>

          {isMoreMenuOpen && (
            <div className="absolute right-0 top-[calc(100%+0.4rem)] w-48 p-1.5 bg-white dark:bg-slate-850 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-xl z-50 space-y-1 backdrop-blur-md animate-in fade-in zoom-in-95 duration-150">
              <button
                type="button"
                onClick={() => {
                  closeOtherTabs(activeTabId);
                  setIsMoreMenuOpen(false);
                }}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <Maximize2 size={13} className="text-slate-400" />
                <span>Close Other Tabs</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  closeAllTabs();
                  setIsMoreMenuOpen(false);
                }}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors cursor-pointer"
              >
                <X size={13} className="text-rose-500" />
                <span>Close All (Reset)</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
export default TabBar;
