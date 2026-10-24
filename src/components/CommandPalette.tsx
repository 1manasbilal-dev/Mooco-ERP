import React, { useState, useEffect, useId, useMemo, useRef } from 'react';
import { useDairy } from '../context/DairyContext';
import { useTabs } from '../context/TabContext';
import {
  Search, LayoutDashboard, ShoppingCart, GitBranch, Factory, Package,
  Archive, Users, Truck, Receipt, Wallet, Landmark, Settings, BarChart3,
  Store, History, ClipboardCheck, Moon, Sun, Plus, CornerDownLeft
} from 'lucide-react';
import { formatCurrency } from '../lib/formatters';
import { cn } from '../lib/cn';
import { Badge, type Tone } from './ui/Badge';
import { Kbd } from './ui/Field';

interface PaletteItem {
  id: string;
  title: string;
  subtitle?: string;
  /** Extra search words that are not shown, e.g. the Roman Urdu words staff used to type ("khata"). */
  keywords?: string;
  category: 'Navigation' | 'Actions' | 'Customers' | 'Suppliers' | 'Products';
  icon: React.ElementType;
  action: () => void;
  badge?: string;
  badgeColor?: 'lime' | 'amber' | 'blue' | 'rose' | 'slate';
}

const BADGE_TONE: Record<NonNullable<PaletteItem['badgeColor']>, Tone> = {
  lime: 'brand', amber: 'warning', blue: 'info', rose: 'danger', slate: 'neutral',
};

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  toggleTheme?: () => void;
  themeMode?: 'light' | 'dark';
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  isOpen,
  onClose,
  toggleTheme,
  themeMode
}) => {
  const { openTab } = useTabs();
  const { customers, suppliers, items: dairyItems, hasPermission } = useDairy();
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!isOpen) return;
    setQuery('');
    setSelectedIndex(0);
    const previousFocus = document.activeElement as HTMLElement | null;
    const frame = requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
    return () => {
      cancelAnimationFrame(frame);
      // Back to where the operator was (unless an action moved focus somewhere new on purpose).
      if (previousFocus?.isConnected && (document.activeElement === document.body || !document.activeElement)) previousFocus.focus({ preventScroll: true });
    };
  }, [isOpen]);

  const allItems = useMemo<PaletteItem[]>(() => {
    if (!isOpen) return [];
    const items: PaletteItem[] = [
      {
        id: 'nav-dashboard',
        title: 'Dashboard Overview',
        subtitle: 'Live business KPIs and summary',
        category: 'Navigation',
        icon: LayoutDashboard,
        action: () => { openTab('dashboard'); onClose(); }
      },
      {
        id: 'nav-pos',
        title: 'POS Counter (Point of Sale)',
        subtitle: 'Fast touch checkout and billing (F9)',
        category: 'Navigation',
        icon: Store,
        action: () => { openTab('pos'); onClose(); },
        badge: 'Counter',
        badgeColor: 'lime'
      },

      {
        id: 'nav-purchase',
        title: 'Milk Collection',
        subtitle: 'Record morning/evening milk from dairy farmers',
        category: 'Navigation',
        icon: ShoppingCart,
        action: () => { openTab('purchase'); onClose(); },
        badge: 'Dairy',
        badgeColor: 'blue'
      },
      {
        id: 'nav-purchase-supplies',
        title: 'Supplies & Materials',
        subtitle: 'Buy packaging, feed, and other materials',
        category: 'Navigation',
        icon: Package,
        action: () => { openTab('purchase-supplies'); onClose(); },
        badge: 'Dairy',
        badgeColor: 'blue'
      },
      {
        id: 'nav-purchase-details',
        title: 'Milk Collection Details',
        subtitle: 'Farmer-wise liters, rates, and delivery slips',
        category: 'Navigation',
        icon: ClipboardCheck,
        action: () => { openTab('purchase-details'); onClose(); },
        badge: 'Dairy',
        badgeColor: 'blue'
      },
      {
        id: 'nav-allocation',
        title: 'Milk Allocation',
        subtitle: 'Allocate raw milk to processing, retail & sales',
        category: 'Navigation',
        icon: GitBranch,
        action: () => { openTab('allocation'); onClose(); }
      },
      {
        id: 'nav-production',
        title: 'Dairy Production & Yield',
        subtitle: 'Yogurt, Cheese, Cream, Butter processing batches',
        category: 'Navigation',
        icon: Factory,
        action: () => { openTab('production'); onClose(); }
      },
      {
        id: 'nav-sales-history',
        title: 'Sales History & Returns',
        subtitle: 'Inspect past receipts, invoices and returns',
        category: 'Navigation',
        icon: History,
        action: () => { openTab('sales-history'); onClose(); }
      },
      {
        id: 'nav-customer-orders', title: 'Customer Orders',
        subtitle: 'Book products, plan pickup or delivery and track orders',
        category: 'Navigation', icon: ClipboardCheck,
        action: () => { openTab('customer-orders'); onClose(); }
      },
      {
        id: 'nav-cash-control',
        title: 'Daily Shift & Cash Drawer Control',
        subtitle: 'Reconcile physical cash, drawer opening & closing',
        category: 'Navigation',
        icon: ClipboardCheck,
        action: () => { openTab('cash-control'); onClose(); },
        badge: 'Cash',
        badgeColor: 'amber'
      },
      {
        id: 'nav-customers',
        title: 'Customers & Ledgers',
        subtitle: 'Customer directories, live credit and balances',
        keywords: 'khata udhaar',
        category: 'Navigation',
        icon: Users,
        action: () => { openTab('customers'); onClose(); }
      },
      {
        id: 'nav-suppliers',
        title: 'Suppliers & Milk Farmers',
        subtitle: 'Supplier ledgers, daily fat & milk accounts',
        keywords: 'khata doodh',
        category: 'Navigation',
        icon: Truck,
        action: () => { openTab('suppliers'); onClose(); }
      },
      {
        id: 'nav-expenses',
        title: 'Expenses & Vendor Bills',
        subtitle: 'Operational expenses, utilities, payroll & vendor ledgers',
        keywords: 'kharcha kharche khata',
        category: 'Navigation',
        icon: Receipt,
        action: () => { openTab('expenses'); onClose(); }
      },
      {
        id: 'nav-bank-cash',
        title: 'Bank & Cash Accounts',
        subtitle: 'Manage financial accounts, transfers and balances',
        category: 'Navigation',
        icon: Wallet,
        action: () => { openTab('bank-cash'); onClose(); }
      },
      {
        id: 'nav-accounts',
        title: 'Chart of Accounts (COA)',
        subtitle: 'Assets, liabilities, equity, revenue and expense heads',
        category: 'Navigation',
        icon: Landmark,
        action: () => { openTab('accounts'); onClose(); }
      },
      {
        id: 'nav-reports',
        title: 'Reports Centre',
        subtitle: 'Sales, profit, ledger, milk, stock and cash reports',
        keywords: 'khata hisaab',
        category: 'Navigation',
        icon: BarChart3,
        action: () => { openTab('reports'); onClose(); }
      },
      {
        id: 'nav-items',
        title: 'Products & Price Catalog',
        subtitle: 'Manage sale items, barcodes and pricing tiers',
        category: 'Navigation',
        icon: Package,
        action: () => { openTab('items'); onClose(); }
      },
      {
        id: 'nav-inventory',
        title: 'Inventory & Stock Balance',
        subtitle: 'Warehouse stock, raw packaging and adjustments',
        category: 'Navigation',
        icon: Archive,
        action: () => { openTab('inventory'); onClose(); }
      },
      {
        id: 'nav-settings',
        title: 'System Settings & Users',
        subtitle: 'Business profile, printers, SMS and permissions',
        category: 'Navigation',
        icon: Settings,
        action: () => { openTab('settings'); onClose(); }
      },

      {
        id: 'act-new-sale',
        title: 'Start New POS Sale',
        subtitle: 'Open checkout terminal immediately',
        category: 'Actions',
        icon: Plus,
        action: () => { openTab('pos'); onClose(); },
        badge: 'Action',
        badgeColor: 'lime'
      },
      {
        id: 'act-milk-purchase',
        title: 'Record Morning/Evening Milk Entry',
        subtitle: 'Fast entry for supplier milk collection',
        category: 'Actions',
        icon: ShoppingCart,
        action: () => { openTab('purchase'); onClose(); },
        badge: 'Action',
        badgeColor: 'blue'
      },
      {
        id: 'act-record-expense',
        title: 'Record New Expense',
        subtitle: 'Log utility, salary, rent or operational bill',
        category: 'Actions',
        icon: Receipt,
        action: () => { openTab('expenses'); onClose(); },
        badge: 'Action',
        badgeColor: 'amber'
      }
    ];

    // Only offer pages this operator may open (same rule as the sidebar).
    const NAV_MODULE: Record<string, string> = {
      'nav-dashboard': 'dashboard', 'nav-pos': 'pos', 'nav-purchase': 'purchase', 'nav-purchase-supplies': 'purchase',
      'nav-purchase-details': 'purchase', 'nav-allocation': 'allocation', 'nav-production': 'production',
      'nav-sales-history': 'sales_history', 'nav-customer-orders': 'customer_orders', 'nav-cash-control': 'cash_control',
      'nav-customers': 'customers', 'nav-suppliers': 'suppliers', 'nav-expenses': 'expenses', 'nav-bank-cash': 'bank_cash',
      'nav-accounts': 'accounts', 'nav-reports': 'reports', 'nav-items': 'items', 'nav-inventory': 'inventory',
      'nav-settings': 'settings', 'act-new-sale': 'pos', 'act-milk-purchase': 'purchase', 'act-record-expense': 'expenses',
    };
    const canOpen = (id: string) => {
      const module = NAV_MODULE[id];
      if (!module) return true;
      return hasPermission(module) || (module === 'settings' && hasPermission('user_management'));
    };
    for (let i = items.length - 1; i >= 0; i--) {
      if (!canOpen(items[i].id)) items.splice(i, 1);
    }

    if (toggleTheme) {
      items.push({
        id: 'act-toggle-theme',
        title: `Switch to ${themeMode === 'light' ? 'Dark' : 'Light'} Theme`,
        subtitle: 'Toggle application color scheme',
        category: 'Actions',
        icon: themeMode === 'light' ? Moon : Sun,
        action: () => { toggleTheme(); onClose(); }
      });
    }

    // Names, phones and balances only for operators who may open the ledgers
    (hasPermission('customers') ? customers || [] : []).forEach(c => {
      if (!c) return;
      const bal = c.balance || 0;
      items.push({
        id: `cust-${c.id}`,
        title: c.name || 'Customer',
        subtitle: `Customer • Phone: ${c.phone || 'No phone'}${c.city ? ' • ' + c.city : ''}`,
        category: 'Customers',
        icon: Users,
        badge: bal !== 0 ? `${formatCurrency(Math.abs(bal))} ${bal > 0 ? 'Receivable' : 'Advance'}` : 'Clear',
        badgeColor: bal > 0 ? 'rose' : bal < 0 ? 'lime' : 'slate',
        action: () => {
          openTab({ id: 'customers', path: `/customers?id=${c.id}` });
          window.dispatchEvent(new CustomEvent('mooco-select-customer', { detail: { customerId: c.id } }));
          onClose();
        }
      });
    });

    (hasPermission('suppliers') ? suppliers || [] : []).forEach(s => {
      if (!s) return;
      const bal = s.pending_balance ?? s.balance ?? 0;
      items.push({
        id: `supp-${s.id}`,
        title: s.name || 'Supplier',
        subtitle: `Supplier / Farmer • ${s.phone || 'No phone'}${s.city || s.village ? ' • ' + (s.village || s.city) : ''}`,
        category: 'Suppliers',
        icon: Truck,
        badge: bal !== 0 ? `${formatCurrency(Math.abs(bal))} ${bal > 0 ? 'Payable' : 'Advance'}` : 'Clear',
        badgeColor: bal > 0 ? 'amber' : bal < 0 ? 'blue' : 'slate',
        action: () => {
          openTab({ id: 'suppliers', path: `/suppliers?id=${s.id}` });
          window.dispatchEvent(new CustomEvent('mooco-select-supplier', { detail: { supplierId: s.id } }));
          onClose();
        }
      });
    });

    const catalog = hasPermission('pos') ? dairyItems || [] : [];
    catalog.filter(p => p && p.isActive !== false && Array.isArray(p.item_type) && p.item_type.includes('Sale product')).forEach(p => {
      items.push({
        id: `prod-${p.id}`,
        title: p.name || 'Product',
        subtitle: `${(Array.isArray(p.category) ? p.category.join(', ') : p.category) || 'Product'} • ${formatCurrency((p.selling_price || 0))} / ${p.unit || 'unit'}`,
        category: 'Products',
        icon: Package,
        badge: `Rs ${p.selling_price || 0}`,
        badgeColor: 'lime',
        action: () => {
          openTab({ id: 'pos', path: `/pos?product=${encodeURIComponent(p.name || p.id)}` });
          window.dispatchEvent(new CustomEvent('mooco-select-product', { detail: { product: p } }));
          onClose();
        }
      });
    });

    return items;
  }, [isOpen, customers, suppliers, dairyItems, openTab, onClose, toggleTheme, themeMode, hasPermission]);

  // Lower-cased once per open, not on every keystroke for every customer.
  const searchIndex = useMemo(
    () => allItems.map(item => `${item.title}\n${item.subtitle || ''}\n${item.category}\n${item.keywords || ''}`.toLowerCase()),
    [allItems]
  );

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return allItems.filter(i => i.category === 'Navigation' || i.category === 'Actions').slice(0, 10);
    }
    const matches: PaletteItem[] = [];
    for (let i = 0; i < allItems.length && matches.length < 25; i++) {
      if (searchIndex[i].includes(q)) matches.push(allItems[i]);
    }
    return matches;
  }, [allItems, searchIndex, query]);

  const activeIndex = Math.min(selectedIndex, Math.max(0, filteredItems.length - 1));
  const activeItem = filteredItems[activeIndex];

  // Keys typed in the palette belong to it: page shortcuts behind it (POS F8/F9, list hotkeys) never fire.
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    e.stopPropagation();
    const count = filteredItems.length;
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => (Math.min(prev, count - 1) + 1) % Math.max(1, count));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => (Math.min(prev, count - 1) - 1 + count) % Math.max(1, count));
    } else if (e.key === 'Home' && e.ctrlKey) {
      e.preventDefault();
      setSelectedIndex(0);
    } else if (e.key === 'End' && e.ctrlKey) {
      e.preventDefault();
      setSelectedIndex(Math.max(0, count - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      activeItem?.action();
    } else if (e.key === 'Tab') {
      // The search box is the only stop; arrows move through the results.
      e.preventDefault();
    }
  };

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${activeIndex}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  if (!isOpen) return null;

  const optionId = (index: number) => `${listId}-option-${index}`;

  return (
    <div className="fixed inset-0 z-[150] flex items-start justify-center px-3 pt-[9vh] sm:px-4 sm:pt-[14vh]" data-app-modal="true" onKeyDown={handleKeyDown}>
      <div
        className="absolute inset-0 bg-[rgb(2_6_23/0.45)] animate-in fade-in duration-150"
        aria-hidden="true"
        onClick={onClose}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Quick search"
        // Clicks inside keep focus in the search box, so the keyboard keeps working.
        // (The list itself is left alone so its scrollbar can still be dragged.)
        onMouseDown={e => { if (e.target !== inputRef.current && e.target !== listRef.current) e.preventDefault(); }}
        className="relative flex max-h-[min(620px,78dvh)] w-full max-w-2xl flex-col overflow-hidden rounded-card border border-line bg-surface shadow-e3 animate-in fade-in zoom-in-[.98] duration-150"
      >
        <div className="flex shrink-0 items-center gap-3 border-b border-line px-4">
          <Search size={18} className="shrink-0 text-fg-faint" aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={activeItem ? optionId(activeIndex) : undefined}
            aria-label="Search pages, customers, suppliers, actions"
            placeholder="Search pages, customers, suppliers, actions (e.g. POS, Milk, Sale)..."
            value={query}
            onChange={e => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            autoComplete="off"
            spellCheck={false}
            className="ds-control h-14 w-full min-w-0 bg-transparent text-[15px] font-medium text-fg outline-none placeholder:font-normal placeholder:text-fg-faint"
          />
          <Kbd className="hidden sm:inline-flex">Esc</Kbd>
        </div>

        <div ref={listRef} id={listId} role="listbox" aria-label="Results" className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
          {filteredItems.length > 0 ? (
            filteredItems.map((item, index) => {
              const isSelected = index === activeIndex;
              const Icon = item.icon;
              const startsGroup = index === 0 || filteredItems[index - 1].category !== item.category;

              return (
                <React.Fragment key={item.id}>
                  {startsGroup && (
                    <div role="presentation" className={cn('px-2.5 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg-faint', index === 0 ? 'pt-1.5' : 'pt-3')}>
                      {item.category}
                    </div>
                  )}
                  <div
                    id={optionId(index)}
                    role="option"
                    aria-selected={isSelected}
                    data-index={index}
                    onClick={() => item.action()}
                    onMouseMove={() => { if (!isSelected) setSelectedIndex(index); }}
                    className={cn(
                      'flex cursor-pointer items-center gap-3 rounded-control px-2.5 py-2 transition-colors duration-75',
                      isSelected ? 'bg-brand-soft' : 'hover:bg-surface-2'
                    )}
                  >
                    <div className={cn(
                      'flex size-9 shrink-0 items-center justify-center rounded-[10px] transition-colors duration-75',
                      isSelected ? 'bg-brand text-brand-on shadow-e1' : 'bg-surface-2 text-fg-subtle ring-1 ring-inset ring-line'
                    )}>
                      <Icon size={16} aria-hidden="true" />
                    </div>

                    <div className="min-w-0 flex-1">
                      <p className={cn('truncate text-[13.5px] font-semibold', isSelected ? 'text-brand-fg' : 'text-fg')}>{item.title}</p>
                      {item.subtitle && (
                        <p className="truncate text-xs text-fg-subtle">{item.subtitle}</p>
                      )}
                    </div>

                    <div className="ml-2 flex shrink-0 items-center gap-2">
                      {item.badge && (
                        <Badge tone={BADGE_TONE[item.badgeColor || 'slate']} className="hidden tabular-nums sm:inline-flex">{item.badge}</Badge>
                      )}
                      <CornerDownLeft size={14} className={cn('text-brand-fg', isSelected ? 'opacity-100' : 'opacity-0')} aria-hidden="true" />
                    </div>
                  </div>
                </React.Fragment>
              );
            })
          ) : (
            <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
              <span className="flex size-11 items-center justify-center rounded-2xl bg-surface-2 text-fg-faint ring-1 ring-inset ring-line">
                <Search size={20} aria-hidden="true" />
              </span>
              <p className="text-sm font-bold text-fg">No matching results found</p>
              <p className="text-xs text-fg-subtle">Try searching for POS, Purchase, Customer or Expense</p>
            </div>
          )}
        </div>

        <div className="hidden shrink-0 items-center justify-between border-t border-line bg-surface-2/60 px-4 py-2 text-[11px] font-medium text-fg-subtle sm:flex">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5"><Kbd>↑</Kbd><Kbd>↓</Kbd> to navigate</span>
            <span className="flex items-center gap-1.5"><Kbd>↵</Kbd> to select</span>
            <span className="flex items-center gap-1.5"><Kbd>Esc</Kbd> to close</span>
          </div>
          <span>Mooco Smart Search</span>
        </div>
      </div>
    </div>
  );
};
