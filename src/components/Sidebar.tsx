import React, { useState, useEffect, useMemo, useRef } from "react";
import { useLocation } from "react-router-dom";
import { useDairy } from "../context/DairyContext";
import { useTabs } from "../context/TabContext";
import { PermissionModule } from "../types";
import {
  LayoutDashboard,
  ShoppingCart,
  Droplets,
  Package,
  GitBranch,
  Factory,
  Archive,
  Users,
  Truck,
  Receipt,
  Wallet,
  Settings,
  Lock,
  ChevronDown,
  ChevronUp,
  Store,
  ClipboardCheck,
  History,
  Landmark,
  BarChart3,
  LogOut,
  X,
  PanelLeftClose,
  PanelLeftOpen,
  ArrowUpRight,
  MoveLeft,
  ShieldCheck
} from "lucide-react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

import { useSidebarPreference } from '../hooks/useSidebarPreference';
import SwipeRegion from './dashboard/SwipeRegion';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

type NavItemType = 'link' | 'group' | 'separator' | 'section';

interface SubItem {
  id: string;
  label: string;
  icon?: React.ElementType;
}

interface NavItem {
  id?: string;
  label?: string;
  icon?: React.ElementType;
  type: NavItemType;
  subItems?: SubItem[];
}

const MENU_ITEMS: NavItem[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard, type: "link" },

  { type: "section", label: "Counter & Sales" },
  {
    id: "sale-group",
    label: "Sales & POS",
    icon: Store,
    type: "group",
    subItems: [
      { id: "pos", label: "POS Terminal", icon: Store },
      { id: "customer-orders", label: "Customer Orders", icon: ClipboardCheck },
      { id: "sales-history", label: "Sales History & Returns", icon: History },
      { id: "cash-control", label: "Shift & Cash Drawer", icon: ClipboardCheck },
    ],
  },

  { type: "section", label: "Dairy Operations" },
  {
    id: "procurement-group",
    label: "Procurement",
    icon: ShoppingCart,
    type: "group",
    subItems: [
      { id: "purchase", label: "Milk Collection", icon: Droplets },
      { id: "purchase-supplies", label: "Supplies & Materials", icon: Package },
      { id: "purchase-details", label: "Collection Details", icon: ClipboardCheck },
    ],
  },
  { id: "allocation", label: "Milk Allocation", icon: GitBranch, type: "link" },
  { id: "production", label: "Milk Production", icon: Factory, type: "link" },
  { id: "inventory", label: "Inventory Stock", icon: Archive, type: "link" },
  { id: "items", label: "Product Catalog", icon: Package, type: "link" },

  { type: "section", label: "Parties & Ledgers" },
  { id: "customers", label: "Customers Khata", icon: Users, type: "link" },
  { id: "suppliers", label: "Suppliers Khata", icon: Truck, type: "link" },
  { id: "expenses", label: "Expenses & Vendors", icon: Receipt, type: "link" },

  { type: "section", label: "Finance & Accounts" },
  { id: "bank-cash", label: "Bank & Cash", icon: Wallet, type: "link" },
  { id: "accounts", label: "Chart of Accounts", icon: Landmark, type: "link" },
  { id: "reports", label: "Reports Centre", icon: BarChart3, type: "link" },
];

const ACCENTS: Record<string, string> = {
  dashboard: 'lime', 'sale-group': 'amber', 'procurement-group': 'cyan', purchase: 'cyan', 'purchase-supplies': 'cyan', 'purchase-details': 'cyan', allocation: 'cyan',
  production: 'violet', inventory: 'cyan', items: 'violet', customers: 'violet',
  suppliers: 'violet', expenses: 'rose', 'bank-cash': 'cyan', accounts: 'amber', reports: 'lime',
};
const permissionFor = (id = '') => ({
  'sales-history': 'sales_history', 'retail-stock': 'retail_stock',
  'customer-orders': 'customer_orders',
  'cash-control': 'cash_control', 'bank-cash': 'bank_cash',
  'purchase-supplies': 'purchase', 'purchase-details': 'purchase',
}[id] || id) as PermissionModule;

interface SidebarProps {
  activeTab?: string;
  setActiveTab?: (id: string) => void;
  isOpen: boolean;
  onClose: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ activeTab: propActiveTab, setActiveTab: propSetActiveTab, isOpen, onClose }) => {
  const location = useLocation();
  const { hasPermission, currentUser, currentRole, logoutUser, lockTerminalNow, setIsUserSwitcherOpen } = useDairy();
  const { openTab, activeTabId } = useTabs();
  const activeTab = activeTabId || propActiveTab || location.pathname.replace(/^\//, '') || 'dashboard';
  const [autoCollapse, setAutoCollapse] = useSidebarPreference();
  const [isHovered, setIsHovered] = useState(false);
  const [keyboardReveal, setKeyboardReveal] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<string[]>([]);
  const [isDesktop, setIsDesktop] = useState(() => window.matchMedia('(min-width: 768px)').matches);
  const sidebarRef = useRef<HTMLElement>(null);
  const userAreaRef = useRef<HTMLDivElement>(null);
  const profileButtonRef = useRef<HTMLButtonElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const showFullMenu = !isDesktop || !autoCollapse || isHovered || keyboardReveal || isUserMenuOpen;
  const displayName = currentUser?.name?.trim() || 'Owner (Admin)';
  const words = displayName.split(/\s+/);
  const userInitials = (words.length > 1 ? words.slice(0, 2).map(word => word[0]).join('') : displayName.slice(0, 2)).toUpperCase();
  const roleName = currentRole?.name || 'Staff';
  const canAccessSettings = hasPermission('settings') || hasPermission('user_management') || currentUser?.role_id === 'role_super_admin';

  const visibleMenuItems = useMemo(() => {
    const filtered = MENU_ITEMS.map(item => {
      if (item.type === 'link') return hasPermission(permissionFor(item.id)) ? item : null;
      if (item.type === 'group' && item.subItems) {
        const subItems = item.subItems.filter(sub => hasPermission(permissionFor(sub.id)));
        return subItems.length ? { ...item, subItems } : null;
      }
      return item;
    });
    return filtered.filter((item, index) => {
      if (!item) return false;
      if (item.type !== 'section') return true;
      for (let next = index + 1; next < filtered.length; next++) {
        const candidate = filtered[next];
        if (!candidate) continue;
        if (candidate.type === 'section') break;
        if (candidate.type === 'link' || candidate.type === 'group') return true;
      }
      return false;
    }) as NavItem[];
  }, [hasPermission]);

  useEffect(() => {
    const breakpoint = window.matchMedia('(min-width: 768px)');
    const update = () => {
      setIsDesktop(breakpoint.matches);
      setIsHovered(false);
      setKeyboardReveal(false);
      setIsUserMenuOpen(false);
      if (breakpoint.matches) onClose();
    };
    breakpoint.addEventListener('change', update);
    return () => breakpoint.removeEventListener('change', update);
  }, [onClose]);

  useEffect(() => {
    if (['pos', 'customer-orders', 'sales-history', 'cash-control'].includes(activeTab)) {
      setExpandedGroups(prev => prev.includes('sale-group') ? prev : [...prev, 'sale-group']);
    }
    if (['purchase', 'purchase-supplies', 'purchase-details'].includes(activeTab)) {
      setExpandedGroups(prev => prev.includes('procurement-group') ? prev : [...prev, 'procurement-group']);
    }
  }, [activeTab]);

  useEffect(() => {
    if (!isDesktop && !isOpen) setIsUserMenuOpen(false);
  }, [isDesktop, isOpen]);

  useEffect(() => {
    if (!isUserMenuOpen && (isDesktop || !isOpen)) return;
    const onPointer = (event: PointerEvent) => {
      if (isUserMenuOpen && !userAreaRef.current?.contains(event.target as Node)) setIsUserMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      if (isUserMenuOpen) {
        setIsUserMenuOpen(false);
        profileButtonRef.current?.focus({ preventScroll: true });
      } else if (!isDesktop && isOpen) onClose();
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [isUserMenuOpen, isDesktop, isOpen, onClose]);

  useEffect(() => {
    if (!isUserMenuOpen) return;
    const frame = requestAnimationFrame(() => userMenuRef.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [isUserMenuOpen]);

  // Treat the mobile drawer as a dialog: focus remains inside it until it closes.
  useEffect(() => {
    if (isDesktop || !isOpen) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const content = document.querySelector<HTMLElement>('[data-sidebar-content]');
    const wasInert = content?.inert || false;
    if (content) content.inert = true;
    const frame = requestAnimationFrame(() => sidebarRef.current?.querySelector<HTMLButtonElement>('.sidebar-mobile-close')?.focus({ preventScroll: true }));
    return () => {
      cancelAnimationFrame(frame);
      if (content) content.inert = wasInert;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [isDesktop, isOpen]);

  const handleNavigate = (id: string) => {
    setIsUserMenuOpen(false);
    if (propSetActiveTab) propSetActiveTab(id);
    openTab(id);
    if (!isDesktop) onClose();
  };
  const toggleGroup = (id: string) => setExpandedGroups(prev => prev.includes(id) ? prev.filter(group => group !== id) : [...prev, id]);
  const trapMobileFocus = (event: React.KeyboardEvent) => {
    if (isDesktop || !isOpen || event.key !== 'Tab') return;
    const controls: HTMLElement[] = Array.from(sidebarRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input, select, [tabindex="0"]') || []);
    const visibleControls = controls.filter(element => element.getClientRects().length > 0 && !element.closest('[inert]'));
    if (!visibleControls.length) return;
    const first = visibleControls[0], last = visibleControls[visibleControls.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };

  return <>
    {!isDesktop && <div className="sidebar-backdrop" data-open={isOpen} aria-hidden="true" onClick={onClose} />}
    <aside id="mooco-sidebar" ref={sidebarRef} className="mooco-sidebar" data-desktop={isDesktop} data-compact={isDesktop && autoCollapse} data-reveal={showFullMenu} data-open={isOpen}
      role={!isDesktop ? 'dialog' : undefined} aria-label={!isDesktop ? 'Navigation menu' : 'Main sidebar'} aria-modal={!isDesktop && isOpen ? true : undefined}
      aria-hidden={!isDesktop && !isOpen ? true : undefined} inert={!isDesktop && !isOpen}
      onMouseEnter={() => { if (isDesktop && autoCollapse) setIsHovered(true); }}
      onMouseLeave={() => setIsHovered(false)}
      onFocusCapture={event => {
        const target = event.target as HTMLElement;
        if (target.closest('[data-ignore-reveal]')) { setKeyboardReveal(false); return; }
        if (isDesktop && autoCollapse && target.matches(':focus-visible')) setKeyboardReveal(true);
      }}
      onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setKeyboardReveal(false); }}
      onTransitionEnd={event => {
        if (!isDesktop && isOpen && event.target === event.currentTarget && event.propertyName === 'transform' && !event.currentTarget.contains(document.activeElement)) {
          sidebarRef.current?.querySelector<HTMLButtonElement>('.sidebar-mobile-close')?.focus({ preventScroll: true });
        }
      }}
      onKeyDown={trapMobileFocus}>
      <SwipeRegion className="mooco-sidebar-panel" label="Sidebar navigation gestures" onNext={() => { if (!isDesktop) { setIsUserMenuOpen(false); onClose(); } }} onPrevious={() => {}}>
        <div className="sidebar-brand-row">
          <button className="sidebar-brand" onClick={() => handleNavigate('dashboard')} disabled={!hasPermission('dashboard')} aria-label="Go to dashboard" title={!showFullMenu ? 'Mooco Dairy' : undefined}>
            <span className="sidebar-brand-mark" aria-hidden="true">M<span /></span>
            {showFullMenu && <span className="sidebar-brand-copy"><strong>MOOCO<span className="sidebar-brand-period">.</span></strong><small>DAIRY ERP</small></span>}
          </button>
          {!isDesktop && <button className="sidebar-icon-button sidebar-mobile-close" onClick={onClose} aria-label="Close navigation menu"><X size={18} /></button>}
        </div>

        <div className="sidebar-workspace-bar">
          {showFullMenu && <span className="sidebar-workspace-label"><i />Workspace</span>}
          {isDesktop && <button data-ignore-reveal className="sidebar-icon-button sidebar-mode-toggle" aria-label={autoCollapse ? 'Pin sidebar expanded' : 'Use compact sidebar'} title={autoCollapse ? 'Pin sidebar expanded' : 'Use compact sidebar'} onClick={() => {
            setAutoCollapse(!autoCollapse); setIsHovered(false); setKeyboardReveal(false); setIsUserMenuOpen(false);
          }}>{autoCollapse ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}</button>}
          {!isDesktop && <span className="sidebar-access-label"><ShieldCheck size={12} />{roleName}</span>}
        </div>

        <nav className="sidebar-navigation" aria-label="Main navigation">
          {visibleMenuItems.map((item, index) => {
            if (item.type === 'section') return <div key={`section-${index}`} className="sidebar-section"><span>{item.label}</span><i /></div>;
            if (item.type === 'separator') return <div key={`separator-${index}`} className="sidebar-separator" />;
            const Icon = item.icon;
            const active = item.id === activeTab || Boolean(item.subItems?.some(sub => sub.id === activeTab));
            const expanded = expandedGroups.includes(item.id || '');
            return <div className="sidebar-nav-entry" key={item.id || index}>
              <button type="button" className={cn('sidebar-nav-button', active && 'is-active')} data-accent={ACCENTS[item.id || ''] || 'lime'}
                aria-label={item.label} aria-current={active && item.type === 'link' ? 'page' : undefined}
                aria-expanded={item.type === 'group' ? expanded && showFullMenu : undefined} aria-controls={item.type === 'group' ? `sidebar-${item.id}` : undefined}
                title={!showFullMenu ? item.label : undefined}
                onClick={() => item.type === 'group' ? toggleGroup(item.id || '') : handleNavigate(item.id || 'dashboard')}>
                <span className="sidebar-nav-icon" aria-hidden="true">{Icon && <Icon size={18} strokeWidth={1.8} />}</span>
                {showFullMenu && <span className="sidebar-nav-label">{item.label}</span>}
                {showFullMenu && (item.type === 'group' ? <ChevronDown className={cn('sidebar-group-chevron', expanded && 'is-expanded')} size={14} /> : active ? <span className="sidebar-active-dot" aria-hidden="true" /> : <ArrowUpRight className="sidebar-nav-arrow" size={13} aria-hidden="true" />)}
              </button>
              {item.type === 'group' && item.subItems && <div id={`sidebar-${item.id}`} className="sidebar-submenu" data-open={expanded && showFullMenu} aria-hidden={!expanded || !showFullMenu} inert={!expanded || !showFullMenu}>
                <div>{item.subItems.map(sub => {
                  const SubIcon = sub.icon;
                  return <button type="button" key={sub.id} className={cn('sidebar-sub-button', sub.id === activeTab && 'is-active')} onClick={() => handleNavigate(sub.id)} aria-current={sub.id === activeTab ? 'page' : undefined}>
                    {SubIcon && <SubIcon size={15} strokeWidth={1.8} aria-hidden="true" />}<span>{sub.label}</span>
                  </button>;
                })}</div>
              </div>}
            </div>;
          })}
        </nav>

        <div className="sidebar-footer" ref={userAreaRef}>
          {canAccessSettings && <button className={cn('sidebar-nav-button sidebar-settings', activeTab === 'settings' && 'is-active')} data-accent="violet" onClick={() => handleNavigate('settings')} aria-label="Settings" aria-current={activeTab === 'settings' ? 'page' : undefined} title={!showFullMenu ? 'Settings' : undefined}>
            <span className="sidebar-nav-icon" aria-hidden="true"><Settings size={18} strokeWidth={1.8} /></span>{showFullMenu && <><span className="sidebar-nav-label">Settings</span><ArrowUpRight className="sidebar-nav-arrow" size={13} aria-hidden="true" /></>}
          </button>}
          {!isDesktop && <div className="sidebar-swipe-hint"><MoveLeft size={13} />Swipe left to close</div>}
          {isUserMenuOpen && <div className="sidebar-user-menu" ref={userMenuRef} role="dialog" aria-label="User options" id="sidebar-user-options">
            <div className="sidebar-user-menu-heading"><span className="sidebar-avatar">{userInitials}</span><div><strong>{displayName}</strong><span><ShieldCheck size={12} />{roleName}</span></div></div>
            <button onClick={() => { setIsUserMenuOpen(false); if (!isDesktop) onClose(); if (navigator.onLine) lockTerminalNow(); else setIsUserSwitcherOpen(true); }}><Lock size={16} /><span>Switch User / Lock</span></button>
            <button className="sidebar-signout" onClick={() => { setIsUserMenuOpen(false); logoutUser(); }}><LogOut size={16} /><span>Logout / Sign Out</span></button>
          </div>}
          <button type="button" ref={profileButtonRef} className={cn('sidebar-profile', isUserMenuOpen && 'is-open')} onClick={() => setIsUserMenuOpen(prev => !prev)} aria-label={`User menu for ${displayName}`} aria-expanded={isUserMenuOpen} aria-haspopup="dialog" aria-controls="sidebar-user-options" title={!showFullMenu ? displayName : undefined}>
            <span className="sidebar-avatar">{userInitials}<i aria-hidden="true" /></span>
            {showFullMenu && <><span className="sidebar-profile-copy"><strong>{displayName}</strong><small>{roleName}</small></span><ChevronUp size={15} className={cn('sidebar-profile-chevron', isUserMenuOpen && 'is-open')} aria-hidden="true" /></>}
          </button>
        </div>
      </SwipeRegion>
    </aside>
  </>;
};

export default Sidebar;
