import React, { memo, useEffect, useMemo, useRef, useState } from "react";
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
  ChevronsUpDown,
  Store,
  ClipboardCheck,
  History,
  Landmark,
  BarChart3,
  LogOut,
  X,
  ShieldCheck
} from "lucide-react";
import { useSidebarPreference } from '../hooks/useSidebarPreference';
import { IconButton } from './ui/Button';
import { useStableCallback } from './shell/useStableCallback';

type NavItemType = 'link' | 'group' | 'section';

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
  { id: "customers", label: "Customer Ledgers", icon: Users, type: "link" },
  { id: "suppliers", label: "Supplier Ledgers", icon: Truck, type: "link" },
  { id: "expenses", label: "Expenses & Vendors", icon: Receipt, type: "link" },

  { type: "section", label: "Finance & Accounts" },
  { id: "bank-cash", label: "Bank & Cash", icon: Wallet, type: "link" },
  { id: "accounts", label: "Chart of Accounts", icon: Landmark, type: "link" },
  { id: "reports", label: "Reports Centre", icon: BarChart3, type: "link" },
];

/** Every page the menu can open (links and group children). */
const NAV_IDS = MENU_ITEMS.flatMap(item => item.type === 'link' ? [item.id as string] : (item.subItems || []).map(sub => sub.id));
/** Page id -> the group it lives in, so the group opens when one of its pages is active. */
const GROUP_OF: Record<string, string> = Object.fromEntries(
  MENU_ITEMS.flatMap(item => item.type === 'group' ? (item.subItems || []).map(sub => [sub.id, item.id as string]) : []),
);

const permissionFor = (id = '') => ({
  'sales-history': 'sales_history', 'retail-stock': 'retail_stock',
  'customer-orders': 'customer_orders',
  'cash-control': 'cash_control', 'bank-cash': 'bank_cash',
  'purchase-supplies': 'purchase', 'purchase-details': 'purchase',
}[id] || id) as PermissionModule;

const initialsOf = (name: string) => {
  const words = name.split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words.slice(0, 2).map(word => word[0]).join('') : name.slice(0, 2)).toUpperCase();
};

interface SidebarProps {
  activeTab?: string;
  setActiveTab?: (id: string) => void;
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Reads the data context and hands the menu only what it shows. The context changes on every
 * sale and sync; the memoised view below re-renders only when the menu itself would change.
 */
const Sidebar: React.FC<SidebarProps> = ({ activeTab: propActiveTab, setActiveTab: propSetActiveTab, isOpen, onClose }) => {
  const { hasPermission, currentUser, currentRole, logoutUser, lockTerminalNow, setIsUserSwitcherOpen } = useDairy();
  const { openTab, activeTabId } = useTabs();
  const allowedIds = NAV_IDS.filter(id => hasPermission(permissionFor(id))).join(',');
  const canAccessSettings = hasPermission('settings') || hasPermission('user_management') || currentUser?.role_id === 'role_super_admin';

  const onNavigate = useStableCallback((id: string) => {
    if (propSetActiveTab) propSetActiveTab(id);
    openTab(id);
  });
  const onLock = useStableCallback(() => {
    // A real lock: the screen only opens again with a PIN. Offline the PIN cannot be
    // checked, so (like the idle lock) it stays a plain user switcher.
    if (navigator.onLine) lockTerminalNow();
    else setIsUserSwitcherOpen(true);
  });
  const onLogout = useStableCallback(() => logoutUser());

  return (
    <SidebarView
      allowedIds={allowedIds}
      activeId={activeTabId || propActiveTab || 'dashboard'}
      userName={currentUser?.name?.trim() || 'Owner (Admin)'}
      roleName={currentRole?.name || 'Staff'}
      canAccessSettings={canAccessSettings}
      canOpenDashboard={hasPermission('dashboard')}
      isOpen={isOpen}
      onClose={onClose}
      onNavigate={onNavigate}
      onLock={onLock}
      onLogout={onLogout}
    />
  );
};

export interface SidebarViewProps {
  /** Comma-separated page ids this operator may open. */
  allowedIds: string;
  activeId: string;
  userName: string;
  roleName: string;
  canAccessSettings: boolean;
  canOpenDashboard: boolean;
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (id: string) => void;
  onLock: () => void;
  onLogout: () => void;
}

const DESKTOP_QUERY = '(min-width: 768px)';
const FOCUSABLE = 'button:not(:disabled), a[href], input, select, [tabindex="0"]';

/** The navigation itself; also rendered by the dev gallery with sample props. */
export const SidebarView = memo(({
  allowedIds, activeId, userName, roleName, canAccessSettings, canOpenDashboard, isOpen, onClose, onNavigate, onLock, onLogout,
}: SidebarViewProps) => {
  const [autoCollapse] = useSidebarPreference();
  const [isHovered, setIsHovered] = useState(false);
  const [keyboardReveal, setKeyboardReveal] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<string[]>([]);
  const [isDesktop, setIsDesktop] = useState(() => window.matchMedia(DESKTOP_QUERY).matches);
  const sidebarRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const userAreaRef = useRef<HTMLDivElement>(null);
  const profileButtonRef = useRef<HTMLButtonElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const hoverTimer = useRef<number | undefined>(undefined);
  const swipeStart = useRef<{ x: number; y: number } | null>(null);
  const showFullMenu = !isDesktop || !autoCollapse || isHovered || keyboardReveal || isUserMenuOpen;
  const userInitials = initialsOf(userName);

  const visibleMenuItems = useMemo(() => {
    const allowed = new Set(allowedIds.split(','));
    const filtered = MENU_ITEMS.map(item => {
      if (item.type === 'link') return allowed.has(item.id || '') ? item : null;
      if (item.type === 'group' && item.subItems) {
        const subItems = item.subItems.filter(sub => allowed.has(sub.id));
        return subItems.length ? { ...item, subItems } : null;
      }
      return item;
    });
    // Drop section headings with nothing under them.
    return filtered.filter((item, index) => {
      if (!item) return false;
      if (item.type !== 'section') return true;
      for (let next = index + 1; next < filtered.length; next++) {
        const candidate = filtered[next];
        if (!candidate) continue;
        if (candidate.type === 'section') break;
        return true;
      }
      return false;
    }) as NavItem[];
  }, [allowedIds]);

  useEffect(() => {
    const breakpoint = window.matchMedia(DESKTOP_QUERY);
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

  useEffect(() => () => window.clearTimeout(hoverTimer.current), []);

  // Open the group that holds the page on screen.
  useEffect(() => {
    const group = GROUP_OF[activeId];
    if (group) setExpandedGroups(prev => prev.includes(group) ? prev : [...prev, group]);
  }, [activeId]);

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
      // A dialog on top (confirm, modal) handles its own Escape.
      if (document.querySelector('[data-app-modal="true"], [data-lock-screen]')) return;
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

  // Treat the mobile drawer as a dialog: the page behind is inert and focus stays inside until it closes.
  useEffect(() => {
    if (isDesktop || !isOpen) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const content = document.querySelector<HTMLElement>('[data-shell-content]');
    const wasInert = content?.inert || false;
    if (content) content.inert = true;
    const frame = requestAnimationFrame(() => closeButtonRef.current?.focus({ preventScroll: true }));
    return () => {
      cancelAnimationFrame(frame);
      if (content) content.inert = wasInert;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [isDesktop, isOpen]);

  const handleNavigate = (id: string) => {
    setIsUserMenuOpen(false);
    onNavigate(id);
    if (!isDesktop) onClose();
  };
  const toggleGroup = (id: string) => setExpandedGroups(prev => prev.includes(id) ? prev.filter(group => group !== id) : [...prev, id]);

  const trapMobileFocus = (event: React.KeyboardEvent) => {
    if (isDesktop || !isOpen || event.key !== 'Tab') return;
    const controls: HTMLElement[] = Array.from(sidebarRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) || []);
    const visibleControls = controls.filter(element => element.getClientRects().length > 0 && !element.closest('[inert]'));
    if (!visibleControls.length) return;
    const first = visibleControls[0], last = visibleControls[visibleControls.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };

  const onUserMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const items = Array.from((event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
  };

  return <>
    {!isDesktop && <div className="sidebar-backdrop" data-open={isOpen} aria-hidden="true" onClick={onClose} />}
    <aside id="mooco-sidebar" ref={sidebarRef} className="mooco-sidebar" data-desktop={isDesktop} data-compact={isDesktop && autoCollapse} data-reveal={showFullMenu} data-open={isOpen}
      role={!isDesktop ? 'dialog' : undefined} aria-label={!isDesktop ? 'Navigation menu' : 'Main sidebar'} aria-modal={!isDesktop && isOpen ? true : undefined}
      aria-hidden={!isDesktop && !isOpen ? true : undefined} inert={!isDesktop && !isOpen}
      onMouseEnter={() => {
        if (!isDesktop || !autoCollapse) return;
        // A short delay so the rail does not flap open when the pointer only passes over it.
        window.clearTimeout(hoverTimer.current);
        hoverTimer.current = window.setTimeout(() => setIsHovered(true), 90);
      }}
      onMouseLeave={() => { window.clearTimeout(hoverTimer.current); setIsHovered(false); }}
      onFocusCapture={event => {
        if (isDesktop && autoCollapse && (event.target as HTMLElement).matches(':focus-visible')) setKeyboardReveal(true);
      }}
      onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setKeyboardReveal(false); }}
      onTransitionEnd={event => {
        if (!isDesktop && isOpen && event.target === event.currentTarget && event.propertyName === 'transform' && !event.currentTarget.contains(document.activeElement)) {
          closeButtonRef.current?.focus({ preventScroll: true });
        }
      }}
      onTouchStart={event => {
        const target = event.target as HTMLElement;
        swipeStart.current = isDesktop || event.touches.length !== 1 || target.closest('input, select, textarea') ? null : { x: event.touches[0].clientX, y: event.touches[0].clientY };
      }}
      onTouchEnd={event => {
        const start = swipeStart.current;
        swipeStart.current = null;
        if (!start || event.changedTouches.length !== 1) return;
        const dx = event.changedTouches[0].clientX - start.x;
        const dy = event.changedTouches[0].clientY - start.y;
        // Swipe left closes the drawer.
        if (dx < -56 && Math.abs(dx) > Math.abs(dy) * 1.3) { setIsUserMenuOpen(false); onClose(); }
      }}
      onKeyDown={trapMobileFocus}>
      <div className="sb-panel">
        <div className="sb-brand-row">
          <button type="button" className="sb-brand" onClick={() => handleNavigate('dashboard')} disabled={!canOpenDashboard} aria-label="Mooco Dairy ERP, go to dashboard" title={!showFullMenu ? 'Mooco Dairy ERP' : undefined}>
            <span className="sb-brand-mark" aria-hidden="true">M</span>
            {showFullMenu && <span className="sb-brand-copy"><strong>Mooco</strong><small>Dairy ERP</small></span>}
          </button>
          {!isDesktop && <IconButton ref={closeButtonRef} variant="ghost" size="sm" aria-label="Close navigation menu" icon={<X />} onClick={onClose} />}
        </div>

        <nav className="sb-nav" aria-label="Main navigation">
          {visibleMenuItems.map((item, index) => {
            if (item.type === 'section') return <div key={`section-${index}`} className="sb-section"><span>{item.label}</span></div>;
            const Icon = item.icon;
            const isGroup = item.type === 'group';
            const containsActive = item.id === activeId || Boolean(item.subItems?.some(sub => sub.id === activeId));
            const expanded = expandedGroups.includes(item.id || '');
            // An open group shows its active page inside; a closed group (or the rail) marks itself.
            const state = !containsActive ? undefined : isGroup && expanded && showFullMenu ? 'parent' : 'active';
            return <div className="sb-entry" key={item.id || index}>
              <button type="button" className="sb-item" data-state={state}
                aria-label={item.label} aria-current={containsActive && !isGroup ? 'page' : undefined}
                aria-expanded={isGroup ? expanded && showFullMenu : undefined} aria-controls={isGroup ? `sidebar-${item.id}` : undefined}
                title={!showFullMenu ? item.label : undefined}
                onClick={() => isGroup ? toggleGroup(item.id || '') : handleNavigate(item.id || 'dashboard')}>
                <span className="sb-item-icon" aria-hidden="true">{Icon && <Icon size={18} strokeWidth={1.9} />}</span>
                {showFullMenu && <span className="sb-item-label">{item.label}</span>}
                {showFullMenu && isGroup && <ChevronDown className="sb-chevron" data-expanded={expanded} size={15} aria-hidden="true" />}
              </button>
              {isGroup && item.subItems && <div id={`sidebar-${item.id}`} className="sb-sub" data-open={expanded && showFullMenu} aria-hidden={!expanded || !showFullMenu} inert={!expanded || !showFullMenu}>
                <div>{item.subItems.map(sub => {
                  const SubIcon = sub.icon;
                  return <button type="button" key={sub.id} className="sb-subitem" onClick={() => handleNavigate(sub.id)} aria-current={sub.id === activeId ? 'page' : undefined}>
                    {SubIcon && <SubIcon size={15} strokeWidth={1.9} aria-hidden="true" />}<span>{sub.label}</span>
                  </button>;
                })}</div>
              </div>}
            </div>;
          })}
        </nav>

        <div className="sb-footer" ref={userAreaRef}>
          {canAccessSettings && <button type="button" className="sb-item" data-state={activeId === 'settings' ? 'active' : undefined} onClick={() => handleNavigate('settings')} aria-label="Settings" aria-current={activeId === 'settings' ? 'page' : undefined} title={!showFullMenu ? 'Settings' : undefined}>
            <span className="sb-item-icon" aria-hidden="true"><Settings size={18} strokeWidth={1.9} /></span>{showFullMenu && <span className="sb-item-label">Settings</span>}
          </button>}
          {isUserMenuOpen && <div className="sb-user-menu" ref={userMenuRef} role="menu" aria-label="User options" id="sidebar-user-options" onKeyDown={onUserMenuKeyDown}>
            <div className="sb-user-menu-head" role="presentation">
              <span className="sb-avatar" aria-hidden="true">{userInitials}</span>
              <div><strong>{userName}</strong><span><ShieldCheck size={12} aria-hidden="true" />{roleName}</span></div>
            </div>
            <button type="button" role="menuitem" className="sb-menu-item" onClick={() => { setIsUserMenuOpen(false); if (!isDesktop) onClose(); onLock(); }}><Lock size={16} aria-hidden="true" /><span>Switch User / Lock</span></button>
            <button type="button" role="menuitem" className="sb-menu-item" data-tone="danger" onClick={() => { setIsUserMenuOpen(false); onLogout(); }}><LogOut size={16} aria-hidden="true" /><span>Logout / Sign Out</span></button>
          </div>}
          <button type="button" ref={profileButtonRef} className="sb-profile" onClick={() => setIsUserMenuOpen(prev => !prev)} aria-label={`User menu for ${userName}`} aria-expanded={isUserMenuOpen} aria-haspopup="menu" aria-controls="sidebar-user-options" title={!showFullMenu ? userName : undefined}>
            <span className="sb-avatar" aria-hidden="true">{userInitials}<i /></span>
            {showFullMenu && <><span className="sb-profile-copy"><strong>{userName}</strong><small>{roleName}</small></span><ChevronsUpDown size={15} className="sb-profile-chevron" aria-hidden="true" /></>}
          </button>
        </div>
      </div>
    </aside>
  </>;
});
SidebarView.displayName = 'SidebarView';

export default Sidebar;
