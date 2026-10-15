import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDairy } from '../context/DairyContext';
import { useTabs } from '../context/TabContext';
import {
  Search, LayoutDashboard, ShoppingCart, GitBranch, Factory, Package,
  Archive, Users, Truck, Receipt, Wallet, Landmark, FileText, Settings,
  Store, History, ClipboardCheck, Moon, Sun, Plus, ArrowRight, CornerDownLeft
} from 'lucide-react';

interface PaletteItem {
  id: string;
  title: string;
  subtitle?: string;
  category: 'Navigation' | 'Actions' | 'Customers' | 'Suppliers' | 'Products';
  icon: React.ElementType;
  action: () => void;
  badge?: string;
  badgeColor?: 'lime' | 'amber' | 'blue' | 'rose' | 'slate';
}

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
  const navigate = useNavigate();
  const { openTab } = useTabs();
  const { customers, suppliers, items: dairyItems } = useDairy();
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Build items database
  const allItems = useMemo<PaletteItem[]>(() => {
    if (!isOpen) return [];
    const items: PaletteItem[] = [
      // Quick Navigation
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
        title: 'Customers & Khata Ledger',
        subtitle: 'Customer directories, live credit and balances',
        category: 'Navigation',
        icon: Users,
        action: () => { openTab('customers'); onClose(); }
      },
      {
        id: 'nav-suppliers',
        title: 'Suppliers & Milk Farmers',
        subtitle: 'Supplier ledgers, daily fat & milk accounts',
        category: 'Navigation',
        icon: Truck,
        action: () => { openTab('suppliers'); onClose(); }
      },
      {
        id: 'nav-expenses',
        title: 'Expenses & Vendor Bills',
        subtitle: 'Operational expenses, utilities, payroll & vendor khata',
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
        title: 'Financial Reports & Audits',
        subtitle: 'P&L, balance sheet, trial balance and audit logs',
        category: 'Navigation',
        icon: FileText,
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

      // Quick Actions
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

    // Live Customers
    (customers || []).forEach(c => {
      if (!c) return;
      const bal = c.balance || 0;
      items.push({
        id: `cust-${c.id}`,
        title: c.name || 'Customer',
        subtitle: `Customer • Phone: ${c.phone || 'No phone'}${c.city ? ' • ' + c.city : ''}`,
        category: 'Customers',
        icon: Users,
        badge: bal !== 0 ? `Rs ${Math.abs(bal).toLocaleString()} ${bal > 0 ? 'Receivable' : 'Advance'}` : 'Clear',
        badgeColor: bal > 0 ? 'rose' : bal < 0 ? 'lime' : 'slate',
        action: () => {
          openTab({ id: 'customers', path: `/customers?id=${c.id}` });
          window.dispatchEvent(new CustomEvent('mooco-select-customer', { detail: { customerId: c.id } }));
          onClose();
        }
      });
    });

    // Live Suppliers
    (suppliers || []).forEach(s => {
      if (!s) return;
      const bal = (s as any).pending_balance ?? s.total_due ?? s.balance ?? 0;
      items.push({
        id: `supp-${s.id}`,
        title: s.name || 'Supplier',
        subtitle: `Supplier / Farmer • ${s.phone || 'No phone'}${s.city || s.village ? ' • ' + (s.village || s.city) : ''}`,
        category: 'Suppliers',
        icon: Truck,
        badge: bal !== 0 ? `Rs ${Math.abs(bal).toLocaleString()} ${bal > 0 ? 'Payable' : 'Advance'}` : 'Clear',
        badgeColor: bal > 0 ? 'amber' : bal < 0 ? 'blue' : 'slate',
        action: () => {
          openTab({ id: 'suppliers', path: `/suppliers?id=${s.id}` });
          window.dispatchEvent(new CustomEvent('mooco-select-supplier', { detail: { supplierId: s.id } }));
          onClose();
        }
      });
    });

    // Live Products
    const catalog = dairyItems || [];
    catalog.filter(p => p && p.isActive !== false && Array.isArray(p.item_type) && p.item_type.includes('Sale product')).forEach(p => {
      items.push({
        id: `prod-${p.id}`,
        title: p.name || 'Product',
        subtitle: `${(Array.isArray(p.category) ? p.category.join(', ') : p.category) || 'Product'} • Rs ${(p.price || 0).toLocaleString()} / ${p.unit || 'unit'}`,
        category: 'Products',
        icon: Package,
        badge: `Rs ${p.price || 0}`,
        badgeColor: 'lime',
        action: () => {
          openTab({ id: 'pos', path: `/pos?product=${encodeURIComponent(p.name || p.id)}` });
          window.dispatchEvent(new CustomEvent('mooco-select-product', { detail: { product: p } }));
          onClose();
        }
      });
    });

    return items;
  }, [isOpen, customers, suppliers, dairyItems, openTab, onClose, toggleTheme, themeMode]);

  // Filter items based on query
  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      // Return top navigation and actions by default
      return allItems.filter(i => i.category === 'Navigation' || i.category === 'Actions').slice(0, 10);
    }
    return allItems.filter(item => {
      return (
        item.title.toLowerCase().includes(q) ||
        (item.subtitle && item.subtitle.toLowerCase().includes(q)) ||
        item.category.toLowerCase().includes(q)
      );
    }).slice(0, 25);
  }, [allItems, query]);

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex(prev => (prev + 1) % Math.max(1, filteredItems.length));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(prev => (prev - 1 + filteredItems.length) % Math.max(1, filteredItems.length));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (filteredItems[selectedIndex]) {
          filteredItems[selectedIndex].action();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, filteredItems, selectedIndex, onClose]);

  // Auto scroll to active index
  useEffect(() => {
    if (listRef.current) {
      const activeEl = listRef.current.querySelector(`[data-index="${selectedIndex}"]`);
      if (activeEl) {
        activeEl.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [selectedIndex]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-16 sm:pt-24 px-3 sm:px-4">
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm transition-opacity duration-200" 
        onClick={onClose} 
      />

      {/* Palette Container */}
      <div className="relative w-full max-w-2xl bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden animate-in zoom-in-95 duration-150 flex flex-col">
        
        {/* Search Bar Input */}
        <div className="flex items-center px-4 py-3.5 border-b border-slate-100 dark:border-slate-800 gap-3">
          <Search size={18} className="text-lime-600 dark:text-lime-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Search pages, customers, suppliers, actions (e.g. POS, Milk, Sale)..."
            value={query}
            onChange={e => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            className="w-full bg-transparent text-sm font-semibold text-slate-800 dark:text-slate-100 placeholder:text-slate-400 outline-none"
          />
          <kbd className="hidden sm:inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold text-slate-400 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
            ESC
          </kbd>
        </div>

        {/* Results List */}
        <div 
          ref={listRef} 
          className="max-h-[60vh] overflow-y-auto p-2 space-y-1 divide-y divide-slate-100 dark:divide-slate-800/40"
        >
          {filteredItems.length > 0 ? (
            filteredItems.map((item, index) => {
              const isSelected = index === selectedIndex;
              const Icon = item.icon;

              return (
                <div
                  key={item.id}
                  data-index={index}
                  onClick={() => item.action()}
                  onMouseEnter={() => setSelectedIndex(index)}
                  className={`flex items-center justify-between p-2.5 rounded-xl cursor-pointer transition-all ${
                    isSelected 
                      ? 'bg-lime-500/10 dark:bg-lime-500/20 text-lime-900 dark:text-lime-100' 
                      : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/60'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                      isSelected 
                        ? 'bg-lime-600 text-white shadow-xs' 
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
                    }`}>
                      <Icon size={16} />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold truncate">
                          {item.title}
                        </span>
                        <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider hidden sm:inline">
                          • {item.category}
                        </span>
                      </div>
                      {item.subtitle && (
                        <p className="text-[11px] text-slate-400 dark:text-slate-500 truncate">
                          {item.subtitle}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 ml-3">
                    {item.badge && (
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md border ${
                        item.badgeColor === 'lime' ? 'bg-lime-50 dark:bg-lime-950/40 text-lime-700 dark:text-lime-400 border-lime-200 dark:border-lime-800' :
                        item.badgeColor === 'amber' ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800' :
                        item.badgeColor === 'rose' ? 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-400 border-rose-200 dark:border-rose-800' :
                        item.badgeColor === 'blue' ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-800' :
                        'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700'
                      }`}>
                        {item.badge}
                      </span>
                    )}

                    {isSelected && (
                      <CornerDownLeft size={14} className="text-lime-600 dark:text-lime-400 animate-in fade-in" />
                    )}
                  </div>
                </div>
              );
            })
          ) : (
            <div className="py-12 text-center text-slate-400">
              <Search size={28} className="mx-auto text-slate-300 dark:text-slate-600 mb-2" />
              <p className="font-bold text-xs text-slate-600 dark:text-slate-300">No matching results found</p>
              <p className="text-[11px] text-slate-400 mt-0.5">Try searching for POS, Purchase, Customer or Expense</p>
            </div>
          )}
        </div>

        {/* Footer with Keyboard Hints */}
        <div className="px-4 py-2 bg-slate-50 dark:bg-slate-800/60 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-[11px] text-slate-400">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded text-[10px] font-bold">↑↓</kbd> to navigate
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded text-[10px] font-bold">↵</kbd> to select
            </span>
          </div>
          <span>Mooco Smart Search</span>
        </div>
      </div>
    </div>
  );
};
