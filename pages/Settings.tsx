import React, { useState, useMemo, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useDairy } from '../context/DairyContext';
import { useToast } from '../context/ToastContext';
import { useSidebarPreference } from '../hooks/useSidebarPreference';
import { AppUser, AppRole, PermissionModule } from '../types';
import { 
  Settings as SettingsIcon, CreditCard, Save, 
  Layout, Globe, Bell, Wallet, ArrowLeft, X,
  Building, Percent, FileText, Package, Briefcase, 
  AlertTriangle, Lock, Check, ToggleLeft, ToggleRight,
  Database, Shield, PlayCircle, Trash2, RefreshCcw, Sliders, Clock,
  ShoppingCart, Store, Factory, Milk, Users, Layers, BookOpen, History,
  UserPlus, Key, Edit2, ShieldAlert, CheckCircle2, UserX, Plus,
  ShieldCheck, UserCheck, Search, Sun, Moon, Info, ArrowRight, Printer, Sparkles,
  ChevronDown, ChevronUp, Crown, UserCheck2, CheckSquare, Square, Eye, Scale, Droplet, Boxes
} from 'lucide-react';
import { UnitManagerModal } from '../components/units/UnitManagerModal';
import { getAllAvailableUnits, getUnitFactorDescription } from '../lib/unitConversion';
import { formatCurrency } from '../lib/formatters';
import { confirmAction } from '../components/ui/ConfirmDialog';

interface SettingsProps {
  onBack?: () => void;
  themeMode?: 'light' | 'dark';
  toggleTheme?: () => void;
}

type SettingTab = 
  | 'company' 
  | 'display' 
  | 'financial' 
  | 'sales' 
  | 'inventory' 
  | 'units'
  | 'production' 
  | 'users' 
  | 'data';

// --- Clean Visual Components ---

const Card: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
  <div className={`bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl sm:rounded-3xl shadow-xs overflow-hidden ${className}`}>
    {children}
  </div>
);

const SectionHeader = ({ 
  icon: Icon, 
  title, 
  desc, 
  badge 
}: { 
  icon: React.ElementType; 
  title: string; 
  desc: string; 
  badge?: string 
}) => (
  <div className="flex items-start justify-between gap-3 pb-4 sm:pb-5 mb-5 sm:mb-6 border-b border-slate-100 dark:border-slate-800">
    <div className="flex items-start sm:items-center gap-3 sm:gap-3.5 min-w-0">
      <div className="w-9 h-9 sm:w-11 sm:h-11 rounded-xl sm:rounded-2xl bg-gradient-to-br from-lime-500 to-lime-600 text-white flex items-center justify-center shadow-md shadow-lime-500/20 shrink-0 mt-0.5 sm:mt-0">
        <Icon size={18} className="sm:w-[22px] sm:h-[22px]" />
      </div>
      <div className="min-w-0">
        <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white tracking-tight leading-snug flex flex-wrap items-center gap-1.5 sm:gap-2">
          <span>{title}</span>
          {badge && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-lime-100 dark:bg-lime-950/60 text-lime-800 dark:text-lime-300 border border-lime-200 dark:border-lime-800 shrink-0">
              {badge}
            </span>
          )}
        </h3>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 sm:mt-1 font-medium leading-relaxed">{desc}</p>
      </div>
    </div>
  </div>
);

const InputGroup = ({ 
  label, 
  children, 
  helpText, 
  required 
}: { 
  label: string; 
  children?: React.ReactNode; 
  helpText?: string; 
  required?: boolean 
}) => (
  <div className="space-y-1.5 min-w-0">
    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
      {label} {required && <span className="text-rose-500">*</span>}
    </label>
    {children}
    {helpText && <p className="text-[11px] text-slate-400 dark:text-slate-500 font-medium leading-relaxed">{helpText}</p>}
  </div>
);

const ToggleRow = ({ 
  label, 
  desc, 
  checked, 
  onChange 
}: { 
  label: string; 
  desc?: string; 
  checked: boolean; 
  onChange: (val: boolean) => void 
}) => (
  <div 
    role="switch" aria-label={label} aria-checked={checked} tabIndex={0}
    onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onChange(!checked); } }}
    onClick={() => onChange(!checked)}
    className="flex items-center justify-between p-3.5 sm:p-4 rounded-xl sm:rounded-2xl border border-slate-200/70 dark:border-slate-800 hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-all cursor-pointer select-none gap-3"
  >
    <div className="min-w-0 flex-1">
      <span className="block text-xs sm:text-sm font-bold text-slate-800 dark:text-slate-200">{label}</span>
      {desc && <span className="block text-[11px] sm:text-xs text-slate-400 dark:text-slate-500 mt-0.5 leading-relaxed">{desc}</span>}
    </div>
    <div className={`transition-colors duration-200 shrink-0 ${checked ? 'text-lime-600 dark:text-lime-400' : 'text-slate-300 dark:text-slate-600'}`}>
      {checked ? <ToggleRight size={32} className="sm:w-[34px] sm:h-[34px]" strokeWidth={2} /> : <ToggleLeft size={32} className="sm:w-[34px] sm:h-[34px]" strokeWidth={2} />}
    </div>
  </div>
);

const SelectInput = ({ 
  value, 
  onChange, 
  options, 
  placeholder = "Select..." 
}: { 
  value: string; 
  onChange: (v: string) => void; 
  options: { id: string; label: string }[]; 
  placeholder?: string 
}) => (
  <select 
    className="w-full px-3.5 sm:px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs sm:text-sm font-medium text-slate-800 dark:text-slate-100 outline-none focus:ring-2 focus:ring-lime-500/20 focus:border-lime-500 transition-all shadow-xs"
    value={value}
    onChange={(e) => onChange(e.target.value)}
  >
    <option value="" className="dark:bg-slate-800 dark:text-slate-300">{placeholder}</option>
    {options.map(opt => <option key={opt.id} value={opt.id} className="dark:bg-slate-800 dark:text-slate-100">{opt.label}</option>)}
  </select>
);

const TextInput = (props: React.InputHTMLAttributes<HTMLInputElement>) => (
  <input 
    {...props}
    className={`w-full px-3.5 sm:px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs sm:text-sm font-medium text-slate-800 dark:text-slate-100 outline-none focus:ring-2 focus:ring-lime-500/20 focus:border-lime-500 transition-all shadow-xs disabled:bg-slate-100 dark:disabled:bg-slate-900 disabled:text-slate-400 dark:disabled:text-slate-600 ${props.className || ''}`}
  />
);

const TAB_GROUPS = [
  {
    group: 'General & Appearance',
    tabs: [
      { id: 'company', label: 'Company Profile', icon: Building, desc: 'Brand name, contact & shifts' },
      { id: 'display', label: 'Display & Interface', icon: Sliders, desc: 'Zoom scale & theme settings' },
    ]
  },
  {
    group: 'Finance & Operations',
    tabs: [
      { id: 'financial', label: 'Accounting & Ledger', icon: CreditCard, desc: 'Till cash, bank & GL mappings' },
      { id: 'sales', label: 'Sales & Invoicing', icon: FileText, desc: 'Prefix, taxes & receipt format' },
      { id: 'inventory', label: 'Inventory Rules', icon: Package, desc: 'Low stock limits & tracking' },
      { id: 'units', label: 'Measurement Units', icon: Scale, desc: 'Pakistani dairy & metric scales (L, kg, pao, maund)' },
      { id: 'production', label: 'Production Settings', icon: Factory, desc: 'Auto-deduction & recipes' },
    ]
  },
  {
    group: 'Security & Access',
    tabs: [
      { id: 'users', label: 'Users & Roles (RBAC)', icon: Shield, desc: 'Operator PINs & permissions' },
    ]
  },
  {
    group: 'System Maintenance',
    tabs: [
      { id: 'data', label: 'Data & Danger Zone', icon: Database, desc: 'Module resets & stock wipe' },
    ]
  }
];

export interface GranularActionDef {
  key: string; // 'view' | 'create' | 'edit' | 'delete' | 'payment' | 'return' | 'discount' | 'export'
  label: string;
  badge: string;
}

export interface GranularModuleDef {
  id: string;
  label: string;
  actions: GranularActionDef[];
}

export interface GranularCategoryGroup {
  category: string;
  icon: any;
  modules: GranularModuleDef[];
}

const GRANULAR_PERMISSION_MODULES: GranularCategoryGroup[] = [
  {
    category: 'POS & Counter Sales',
    icon: Store,
    modules: [
      {
        id: 'pos',
        label: 'POS Counter Billing',
        actions: [
          { key: 'view', label: 'Open POS Counter', badge: 'View' },
          { key: 'create', label: 'Punch Sales & Checkout', badge: 'Checkout' },
          { key: 'discount', label: 'Apply Custom Discounts', badge: 'Discount' }
        ]
      },
      {
        id: 'sales_history',
        label: 'Sales History & Invoices',
        actions: [
          { key: 'view', label: 'View Invoices & Print', badge: 'View' },
          { key: 'return', label: 'Process Sales Returns', badge: 'Returns' },
          { key: 'delete', label: 'Delete / Cancel Invoices', badge: 'Delete' }
        ]
      },
      {
        id: 'customer_orders', label: 'Customer Orders',
        actions: [
          { key: 'view', label: 'View Customer Orders', badge: 'View' },
          { key: 'create', label: 'Book Customer Orders', badge: 'Create' },
          { key: 'edit', label: 'Edit & Prepare Orders', badge: 'Edit' },
          { key: 'cancel', label: 'Cancel Orders', badge: 'Cancel' }
        ]
      },
      {
        id: 'cash_control',
        label: 'Shift & Cash Control',
        actions: [
          { key: 'view', label: 'View shifts & cash custody', badge: 'View' },
          { key: 'create', label: 'Start / close own shift', badge: 'Cashier' },
          { key: 'approve', label: 'Accept remittance & close day', badge: 'Head' }
        ]
      }
    ]
  },
  {
    category: 'Milk & Procurement',
    icon: Milk,
    modules: [
      {
        id: 'purchase',
        label: 'Milk Intake (Purchases)',
        actions: [
          { key: 'view', label: 'View Intake Records', badge: 'View' },
          { key: 'create', label: 'Record Milk Intake', badge: 'Add Entry' },
          { key: 'delete', label: 'Delete / Void Milk Intake', badge: 'Delete' }
        ]
      },
      {
        id: 'allocation',
        label: 'Milk Tank Allocation',
        actions: [
          { key: 'view', label: 'View Tank Allocation', badge: 'View' },
          { key: 'create', label: 'Allocate Milk Pool', badge: 'Allocate' }
        ]
      },
      {
        id: 'suppliers',
        label: 'Suppliers Directory & Rates',
        actions: [
          { key: 'view', label: 'View Suppliers & Khata', badge: 'View' },
          { key: 'create', label: 'Add New Supplier', badge: 'Create' },
          { key: 'edit', label: 'Edit Supplier & Milk Rates', badge: 'Edit' },
          { key: 'delete', label: 'Delete Supplier Profile', badge: 'Delete' },
          { key: 'payment', label: 'Pay Supplier & Record Voucher', badge: 'Payment' }
        ]
      }
    ]
  },
  {
    category: 'Production & Inventory',
    icon: Factory,
    modules: [
      {
        id: 'production',
        label: 'Production Batches',
        actions: [
          { key: 'view', label: 'View Batches & Recipes', badge: 'View' },
          { key: 'create', label: 'Start New Batch', badge: 'Start' },
          { key: 'edit', label: 'Complete / Cancel Batch', badge: 'Manage' }
        ]
      },
      {
        id: 'items',
        label: 'Items & Product Master',
        actions: [
          { key: 'view', label: 'View Products & Pricing', badge: 'View' },
          { key: 'create', label: 'Add New Product', badge: 'Create' },
          { key: 'edit', label: 'Edit Product / Recipe / Price', badge: 'Edit' },
          { key: 'delete', label: 'Delete Product', badge: 'Delete' }
        ]
      },
      {
        id: 'inventory',
        label: 'Live Inventory & Stock Logs',
        actions: [
          { key: 'view', label: 'View Stock & Valuation', badge: 'View' },
          { key: 'edit', label: 'Manual Stock Adjustments', badge: 'Adjust Stock' }
        ]
      }
    ]
  },
  {
    category: 'Finance & Ledgers',
    icon: CreditCard,
    modules: [
      {
        id: 'customers',
        label: 'Customers & Credit Khata',
        actions: [
          { key: 'view', label: 'View Customers & Ledger', badge: 'View' },
          { key: 'create', label: 'Add New Customer', badge: 'Create' },
          { key: 'edit', label: 'Edit Customer Profile', badge: 'Edit' },
          { key: 'delete', label: 'Delete Customer', badge: 'Delete' },
          { key: 'payment', label: 'Receive Customer Payment', badge: 'Receipt' }
        ]
      },
      {
        id: 'expenses',
        label: 'Expenses & Petty Cash',
        actions: [
          { key: 'view', label: 'View Expense Records', badge: 'View' },
          { key: 'create', label: 'Add Expense Voucher', badge: 'Create' },
          { key: 'delete', label: 'Delete Expense Voucher', badge: 'Delete' }
        ]
      },
      {
        id: 'bank_cash',
        label: 'Bank & Cash Accounts',
        actions: [
          { key: 'view', label: 'View Accounts & Balances', badge: 'View' },
          { key: 'create', label: 'Deposit / Withdraw / Transfer', badge: 'Transfers' }
        ]
      },
      {
        id: 'accounts',
        label: 'Chart of Accounts & Journal',
        actions: [
          { key: 'view', label: 'View General Ledger & Vouchers', badge: 'View' },
          { key: 'create', label: 'Post Manual Journal Entry', badge: 'Post JV' }
        ]
      },
      {
        id: 'reports',
        label: 'Financial Reports',
        actions: [
          { key: 'view', label: 'View Financial Statements', badge: 'View' },
          { key: 'export', label: 'Print / Export Reports', badge: 'Export' }
        ]
      }
    ]
  },
  {
    category: 'System & Administration',
    icon: Sliders,
    modules: [
      {
        id: 'dashboard',
        label: 'Executive Dashboard',
        actions: [
          { key: 'view', label: 'View Executive Analytics & Profit', badge: 'View' }
        ]
      },
      {
        id: 'settings',
        label: 'System Settings',
        actions: [
          { key: 'view', label: 'View System Settings', badge: 'View' },
          { key: 'edit', label: 'Modify Company & Accounting Rules', badge: 'Edit' }
        ]
      }
    ]
  }
];

const Settings: React.FC<SettingsProps> = ({ onBack, themeMode = 'light', toggleTheme }) => {
  const { 
    settings, updateSettings, accounts, manualAccounts, resetSystem, clearData,
    purchases = [], materialPurchases = [], allocations = [], sales = [], dailySupplyEntries = [],
    productionBatches = [], suppliers = [], customers = [], items = [], inventory = [], inventoryLogs = [],
    expenses = [], recurringExpenses = [], expenseVendors = [], bankTransactions = [], journalEntries = [],
    retailClosings = [], customerTransactions = [], supplierTransactions = [],
    users = [], roles = [], currentUser, currentRole, addUser, updateUser, deleteUser, createRole, updateRole, deleteRole, hasPermission, canPerform
  } = useDairy();
  const { showToast } = useToast();
  const { subtab } = useParams<{ subtab?: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const validTabs: SettingTab[] = ['company', 'display', 'financial', 'sales', 'inventory', 'units', 'production', 'users', 'data'];
  const getTabFromUrl = (): SettingTab => {
    const params = new URLSearchParams(window.location.search);
    const qTab = params.get('tab');
    if (qTab && validTabs.includes(qTab as SettingTab)) return qTab as SettingTab;
    if (subtab && validTabs.includes(subtab as SettingTab)) return subtab as SettingTab;
    return 'company';
  };
  const [activeTab, setActiveTab] = useState<SettingTab>(getTabFromUrl);
  const [isUnitManagerModalOpen, setIsUnitManagerModalOpen] = useState(false);

  const selectTab = (tab: SettingTab) => {
    setActiveTab(tab);
    navigate(`/settings?tab=${tab}`);
  };

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const qTab = params.get('tab');
    if (qTab && validTabs.includes(qTab as SettingTab)) {
      setActiveTab(qTab as SettingTab);
    }
  }, [location.search]);
  const [userSearchQuery, setUserSearchQuery] = useState('');
  const [expandedRoleIds, setExpandedRoleIds] = useState<Record<string, boolean>>({});

  const [zoomScale, setZoomScale] = useState<number>(() => {
    const saved = localStorage.getItem('app_zoom_scale');
    return saved ? parseInt(saved, 10) : 100;
  });
  const [sidebarAutoCollapse, setSidebarAutoCollapse] = useSidebarPreference();
  const [newShiftName, setNewShiftName] = useState('');

  // RBAC User & Role Modals
  const [userModalOpen, setUserModalOpen] = useState(false);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [userForm, setUserForm] = useState<{
    name: string;
    username: string;
    pin: string;
    role_id: string;
    phone: string;
    is_active: boolean;
    permissions: string[];
  }>({
    name: '',
    username: '',
    pin: '',
    role_id: 'role_cashier',
    phone: '',
    is_active: true,
    permissions: []
  });

  const [roleModalOpen, setRoleModalOpen] = useState(false);
  const [editingRoleId, setEditingRoleId] = useState<string | null>(null);
  const [roleForm, setRoleForm] = useState<{
    name: string;
    description: string;
    permissions: string[];
  }>({
    name: '',
    description: '',
    permissions: []
  });

  const [selectedModules, setSelectedModules] = useState<Set<string>>(new Set());

  // Confirm Modal
  const [confirmConfig, setConfirmConfig] = useState<{
     isOpen: boolean;
     title: string;
     message: string;
     actionType: 'reset_system' | 'clear_transactions' | 'clear_module' | 'clear_multiple_modules';
     moduleName?: string;
     displayLabel?: string;
     selectedModuleIds?: string[];
     selectedModuleNames?: string[];
  }>({
     isOpen: false,
     title: '',
     message: '',
     actionType: 'reset_system'
  });

  // Assignable roles list (EXCLUDES Super Admin since Super Admin is unique and cannot be assigned to staff)
  const assignableRoles = useMemo(() => {
    return roles.filter(r => r.id !== 'role_super_admin');
  }, [roles]);

  // Per-user extra access — structured like the role editor: main module with
  // expandable sub-actions. Stored on the user, merged over the role's access.
  const [expandedUserPermModules, setExpandedUserPermModules] = useState<Set<string>>(new Set());
  const rolePermSet = useMemo(
    () => new Set<string>((roles.find(r => r.id === userForm.role_id)?.permissions || []).map(String)),
    [roles, userForm.role_id]
  );
  const roleGrantsFullModule = (moduleId: string) => rolePermSet.has(moduleId);
  const roleGrantsAction = (moduleId: string, actionKey: string) => rolePermSet.has(`${moduleId}:${actionKey}`);
  const userHasFullModule = (moduleId: string) => userForm.permissions.includes(moduleId);
  const userHasAction = (moduleId: string, actionKey: string) => userForm.permissions.includes(`${moduleId}:${actionKey}`);

  const toggleUserModuleAccess = (moduleId: string, actionKeys: string[]) => {
    setUserForm(prev => {
      if (prev.permissions.includes(moduleId)) {
        // Remove full module + any granular extras of this module
        return { ...prev, permissions: prev.permissions.filter(p => p !== moduleId && !p.startsWith(`${moduleId}:`)) };
      }
      // Full module covers all actions — drop redundant granular extras
      return { ...prev, permissions: [moduleId, ...prev.permissions.filter(p => !actionKeys.includes(p))] };
    });
  };

  const toggleUserActionAccess = (moduleId: string, actionKey: string) => {
    const key = `${moduleId}:${actionKey}`;
    setUserForm(prev => ({
      ...prev,
      permissions: prev.permissions.includes(key) ? prev.permissions.filter(p => p !== key) : [...prev.permissions, key]
    }));
  };

  const toggleUserPermModuleExpand = (moduleId: string) => {
    setExpandedUserPermModules(prev => {
      const next = new Set(prev);
      if (next.has(moduleId)) next.delete(moduleId); else next.add(moduleId);
      return next;
    });
  };

  const toggleRoleExpand = (roleId: string) => {
    setExpandedRoleIds(prev => ({ ...prev, [roleId]: !prev[roleId] }));
  };

  const handleOpenAddUser = () => {
    setEditingUserId(null);
    setUserForm({
      name: '',
      username: '',
      pin: '',
      role_id: assignableRoles[0]?.id || 'role_cashier',
      phone: '',
      is_active: true,
      permissions: []
    });
    setUserModalOpen(true);
  };

  const handleOpenEditUser = (user: AppUser) => {
    setEditingUserId(user.id);
    setUserForm({
      name: user.name,
      username: user.username,
      pin: '', // PINs are hashed server-side; leave blank to keep the current one
      role_id: user.role_id,
      phone: user.phone || '',
      is_active: user.is_active !== false,
      permissions: Array.isArray(user.permissions) ? [...user.permissions] : []
    });
    setUserModalOpen(true);
  };

  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userForm.name.trim()) return showToast('Name zaroori hai', 'warning');
    if (!userForm.username.trim()) return showToast('Username zaroori hai', 'warning');
    // PIN is mandatory for new users; when editing, blank = keep existing PIN.
    if (!editingUserId || userForm.pin.trim()) {
      if (!userForm.pin.trim() || userForm.pin.length !== 4 || !/^\d{4}$/.test(userForm.pin)) {
        return showToast('4-Digit PIN code enter karein (e.g. 1234)', 'warning');
      }
    }

    try {
      if (editingUserId) {
        const ok = await updateUser(editingUserId, userForm);
        if (!ok) return;
      } else {
        const ok = await addUser(userForm);
        if (!ok) return;
      }
      setUserModalOpen(false);
    } catch (err: any) {
      showToast(`Error: ${err?.message || 'Failed to save user'}`, 'error');
    }
  };

  const handleOpenAddRole = () => {
    setEditingRoleId(null);
    setRoleForm({
      name: '',
      description: '',
      permissions: ['pos:view', 'pos:create', 'sales_history:view']
    });
    setRoleModalOpen(true);
  };

  const handleOpenEditRole = (role: AppRole) => {
    setEditingRoleId(role.id);
    // Expand legacy module keys if present (e.g. if 'customers' is in permissions, expand to all its actions)
    const permsSet = new Set<string>();
    role.permissions.forEach(p => {
      permsSet.add(p);
      // If it's a base module name, add its sub-actions too
      GRANULAR_PERMISSION_MODULES.forEach(cat => {
        cat.modules.forEach(m => {
          if (m.id === p) {
            m.actions.forEach(a => permsSet.add(`${m.id}:${a.key}`));
          }
        });
      });
    });

    setRoleForm({
      name: role.name,
      description: role.description || '',
      permissions: Array.from(permsSet)
    });
    setRoleModalOpen(true);
  };

  const handleSaveRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!roleForm.name.trim()) return showToast('Role Name zaroori hai', 'warning');
    if (roleForm.permissions.length === 0) return showToast('Kam az kam ek permission action select karein', 'warning');

    try {
      if (editingRoleId) {
        const ok = await updateRole(editingRoleId, roleForm as any);
        if (!ok) return;
      } else {
        const ok = await createRole(roleForm as any);
        if (!ok) return;
      }
      setRoleModalOpen(false);
    } catch (err: any) {
      showToast(`Error: ${err?.message || 'Failed to save role'}`, 'error');
    }
  };

  const handleAddShift = () => {
    if (!newShiftName.trim()) return;
    const currentShifts = settings.general.shifts || ['Morning', 'Evening'];
    if (currentShifts.includes(newShiftName.trim())) {
      return showToast("Shift already exists", "warning");
    }
    updateSettings({
      general: {
        ...settings.general,
        shifts: [...currentShifts, newShiftName.trim()]
      }
    });
    setNewShiftName('');
    showToast("Shift added successfully", "success");
  };

  const handleRemoveShift = (shift: string) => {
    const currentShifts = settings.general.shifts || ['Morning', 'Evening'];
    if (currentShifts.length <= 1) {
      return showToast("At least one shift is required.", "warning");
    }
    updateSettings({
      general: {
        ...settings.general,
        shifts: currentShifts.filter(s => s !== shift)
      }
    });
    showToast("Shift removed successfully", "success");
  };

  const handleZoomChange = (val: number) => {
    setZoomScale(val);
    localStorage.setItem('app_zoom_scale', val.toString());
    document.documentElement.style.fontSize = `${(val / 100) * 16}px`;
  };

  const handleSidebarAutoCollapseChange = (val: boolean) => {
    setSidebarAutoCollapse(val);
  };

  const handleCompanyChange = (key: keyof typeof settings.general, value: any) => {
    updateSettings({ general: { ...settings.general, [key]: value } });
  };

  const handleFinancialChange = (key: keyof typeof settings.financial, value: any) => {
    updateSettings({ financial: { ...settings.financial, [key]: value } });
  };

  const handleSalesChange = (key: keyof typeof settings.sales, value: any) => {
    updateSettings({ sales: { ...settings.sales, [key]: value } });
  };

  const handleInventoryChange = (key: keyof typeof settings.inventory, value: any) => {
    updateSettings({ inventory: { ...settings.inventory, [key]: value } });
  };

  // Filtered users for search query
  const filteredUsers = useMemo(() => {
    if (!userSearchQuery.trim()) return users;
    const q = userSearchQuery.toLowerCase();
    return users.filter(u => 
      u.name.toLowerCase().includes(q) || 
      u.username.toLowerCase().includes(q) || 
      (u.phone && u.phone.includes(q))
    );
  }, [users, userSearchQuery]);

  // Dropdown lists
  const allAccountsList = [
    ...accounts.map(a => ({ id: a.id, label: `${a.name} (${a.type})`, type: a.type })),
    ...manualAccounts.map(a => ({ id: a.id, label: `${a.name} (${a.type})`, type: a.type }))
  ];

  const incomeAccounts = allAccountsList.filter(a => a.type === 'Income' || a.type === 'Bank' || a.type === 'Cash');
  const expenseAccounts = allAccountsList.filter(a => a.type === 'Expense' || a.type === 'Liability');

  return (
    <div className="min-h-screen bg-slate-50/80 dark:bg-slate-950 flex flex-col font-sans transition-colors duration-150">
      
      {/* Top Navigation Bar */}
      <header className="bg-white/90 dark:bg-slate-900/90 backdrop-blur-md border-b border-slate-200/80 dark:border-slate-800 sticky top-0 z-30 shadow-2xs">
        <div className="max-w-7xl mx-auto px-3 sm:px-4 md:px-8 py-2.5 sm:py-3.5 flex items-center justify-between gap-2.5 sm:gap-4">
          <div className="flex items-center gap-2.5 sm:gap-3.5 min-w-0">
            <button aria-label="Return to Dashboard" 
              onClick={onBack} 
              className="p-2 sm:p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition-all cursor-pointer shadow-2xs shrink-0"
              title="Return to Dashboard"
            >
              <ArrowLeft size={18} />
            </button>
            <div className="min-w-0">
              <h1 className="text-base sm:text-lg md:text-xl font-black text-slate-900 dark:text-white tracking-tight flex items-center gap-1.5 sm:gap-2 truncate">
                <span className="truncate">System Settings</span>
                <span className="px-2 py-0.5 rounded-full text-[9px] sm:text-[10px] font-extrabold bg-lime-100 text-lime-800 dark:bg-lime-900/40 dark:text-lime-300 border border-lime-200/60 dark:border-lime-700/40 shrink-0">
                  Control Panel
                </span>
              </h1>
              <p className="text-xs text-slate-400 dark:text-slate-500 font-medium hidden sm:block truncate">
                Company profile, accounting defaults, staff permissions & data management
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button 
              onClick={() => showToast('All configuration changes are saved automatically.', 'success')}
              className="bg-lime-600 hover:bg-lime-500 text-white px-3 sm:px-4 py-2 rounded-xl font-bold text-xs sm:text-sm flex items-center gap-1.5 sm:gap-2 shadow-sm shadow-lime-600/20 transition-all active:scale-95 cursor-pointer shrink-0"
            >
              <Save size={15} />
              <span>Save</span>
              <span className="hidden sm:inline">& Apply</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Settings Body */}
      <div className="flex-1 max-w-7xl mx-auto w-full px-3 sm:px-4 md:px-8 py-3.5 sm:py-6 md:py-8 flex flex-col lg:flex-row gap-4 sm:gap-6 lg:gap-8">
        
        {/* Mobile Horizontal Tab Navigation (Visible only on screens below lg) */}
        <div className="lg:hidden w-full space-y-2">
          {/* Active Tab Indicator Bar */}
          <div className="flex items-center justify-between px-1 text-xs">
            <span className="text-slate-400 dark:text-slate-500 font-medium">
              Category: <strong className="text-slate-700 dark:text-slate-300 font-bold">{TAB_GROUPS.find(g => g.tabs.some(t => t.id === activeTab))?.group}</strong>
            </span>
            <span className="text-[11px] font-bold text-lime-700 dark:text-lime-400 bg-lime-50 dark:bg-lime-950/60 border border-lime-200 dark:border-lime-800/80 px-2 py-0.5 rounded-lg">
              {TAB_GROUPS.flatMap(g => g.tabs).find(t => t.id === activeTab)?.label}
            </span>
          </div>

          {/* Horizontally scrollable smooth tabs */}
          <div className="flex items-center gap-2 overflow-x-auto pb-2 pt-0.5 scrollbar-hide -mx-3 px-3 sm:mx-0 sm:px-0">
            {TAB_GROUPS.flatMap(g => g.tabs).map(t => {
              const Icon = t.icon;
              const isActive = activeTab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => selectTab(t.id as SettingTab)}
                  className={`flex items-center gap-2 px-3.5 py-2.5 rounded-2xl whitespace-nowrap text-xs font-bold transition-all shrink-0 cursor-pointer select-none ${
                    isActive
                      ? 'bg-lime-500 text-white shadow-md shadow-lime-500/25 ring-2 ring-lime-500/20'
                      : 'bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  <Icon size={16} className={isActive ? 'text-white' : 'text-slate-400 dark:text-slate-500'} />
                  <span>{t.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Left Side Navigation Menu (Desktop: hidden on screens below lg) */}
        <aside className="hidden lg:block w-72 shrink-0 space-y-6">
          <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-3xl p-3 shadow-xs space-y-5 sticky top-24">
            {TAB_GROUPS.map((grp, gIdx) => (
              <div key={gIdx} className="space-y-1">
                <div className="px-3 text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-1.5">
                  {grp.group}
                </div>
                {grp.tabs.map(t => {
                  const Icon = t.icon;
                  const isActive = activeTab === t.id;

                  return (
                    <button
                      key={t.id}
                      onClick={() => selectTab(t.id as SettingTab)}
                      className={`w-full text-left p-2.5 rounded-2xl transition-all flex items-center gap-3 cursor-pointer ${
                        isActive
                          ? 'bg-lime-500 text-white shadow-md shadow-lime-500/20 font-bold'
                          : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100/80 dark:hover:bg-slate-800/60 font-semibold'
                      }`}
                    >
                      <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
                        isActive ? 'bg-white/20 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
                      }`}>
                        <Icon size={16} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-xs truncate leading-tight">{t.label}</div>
                        <div className={`text-[10px] truncate mt-0.5 ${isActive ? 'text-lime-100 font-normal' : 'text-slate-400'}`}>
                          {t.desc}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>

          {/* Quick Info Box */}
          <div className="bg-gradient-to-br from-lime-500/10 to-emerald-500/10 dark:from-lime-950/30 dark:to-emerald-950/30 border border-lime-200/60 dark:border-lime-900/40 rounded-3xl p-4 text-xs space-y-2">
            <div className="flex items-center gap-2 font-bold text-lime-900 dark:text-lime-200">
              <Sparkles size={16} className="text-lime-600" />
              <span>Mooco ERP Cloud Sync</span>
            </div>
            <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">
              All settings are automatically synchronized across all counters and devices with full offline resilience.
            </p>
          </div>
        </aside>

        {/* Right Side Content Panel */}
        <main className="flex-1 min-w-0">
          <Card className="p-3.5 sm:p-5 md:p-8 min-h-0 sm:min-h-[600px] shadow-sm">
            
            {/* 1. COMPANY PROFILE */}
            {activeTab === 'company' && (
              <div className="space-y-6 animate-in fade-in slide-in-from-right-3 duration-200">
                <SectionHeader 
                  icon={Building} 
                  title="Company & Dairy Profile" 
                  desc="These business details will appear on thermal customer bills, dispatch slips, and financial ledgers."
                  badge="Core Identity"
                />

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5">
                  <div className="md:col-span-2">
                    <InputGroup label="Company / Dairy Name" required helpText="Appears prominently at the top of POS receipts.">
                      <TextInput 
                        value={settings.general.companyName} 
                        onChange={e => handleCompanyChange('companyName', e.target.value)} 
                        placeholder="e.g. Mooco Dairy Farm & Sweets"
                      />
                    </InputGroup>
                  </div>

                  <div className="md:col-span-2">
                    <InputGroup label="Physical Business Address" helpText="Full address shown in receipt footers.">
                      <TextInput 
                        value={settings.general.address} 
                        onChange={e => handleCompanyChange('address', e.target.value)} 
                        placeholder="Shop #12, Main Dairy Market, City"
                      />
                    </InputGroup>
                  </div>

                  <InputGroup label="Phone / Mobile Hotline">
                    <TextInput 
                      value={settings.general.phone} 
                      onChange={e => handleCompanyChange('phone', e.target.value)} 
                      placeholder="0300-1234567"
                    />
                  </InputGroup>

                  <InputGroup label="Email Address">
                    <TextInput 
                      type="email"
                      value={settings.general.email} 
                      onChange={e => handleCompanyChange('email', e.target.value)} 
                      placeholder="support@moocodairy.com"
                    />
                  </InputGroup>
                </div>

                {/* Regional & Financial Parameters */}
                <div className="pt-6 border-t border-slate-100 dark:border-slate-800 space-y-4">
                  <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider flex items-center gap-2">
                    <Globe size={15} className="text-lime-600" />
                    <span>Currency & Regional Format</span>
                  </h4>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
                    <InputGroup label="Currency Symbol">
                      <TextInput 
                        value={settings.general.currencySymbol} 
                        onChange={e => handleCompanyChange('currencySymbol', e.target.value)} 
                        placeholder="Rs"
                      />
                    </InputGroup>

                    <InputGroup label="NTN / Tax Registration #">
                      <TextInput 
                        value={settings.general.taxId} 
                        onChange={e => handleCompanyChange('taxId', e.target.value)} 
                        placeholder="e.g. 1234567-8"
                      />
                    </InputGroup>

                    <InputGroup label="Fiscal Year Start">
                      <TextInput 
                        type="date" 
                        value={`2026-${settings.general.fiscalYearStart || '01-01'}`} 
                        onChange={e => handleCompanyChange('fiscalYearStart', e.target.value.slice(5))} 
                      />
                    </InputGroup>
                  </div>
                </div>

                {/* Milk Purchase Shifts */}
                <div className="pt-6 border-t border-slate-100 dark:border-slate-800 space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider flex items-center gap-2">
                        <Clock size={15} className="text-lime-600" />
                        <span>Daily Milk Collection Shifts</span>
                      </h4>
                      <p className="text-[11px] text-slate-400 mt-0.5">Shifts available during farmer milk collection.</p>
                    </div>
                  </div>

                  <div className="flex flex-col sm:flex-row gap-2 max-w-md">
                    <TextInput 
                      placeholder="e.g. Afternoon / Dopehar" 
                      value={newShiftName} 
                      onChange={e => setNewShiftName(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), handleAddShift())}
                      className="flex-1 min-w-0"
                    />
                    <button 
                      type="button" 
                      onClick={handleAddShift} 
                      className="w-full sm:w-auto px-5 py-2.5 bg-lime-600 hover:bg-lime-500 text-white font-bold rounded-xl text-xs transition-all shadow-xs cursor-pointer shrink-0"
                    >
                      + Add Shift
                    </button>
                  </div>

                  <div className="flex flex-wrap gap-2 pt-1">
                    {(settings.general.shifts || ['Morning', 'Evening']).map(shift => (
                      <div 
                        key={shift} 
                        className="flex items-center gap-2 px-3.5 py-2 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl font-bold text-xs text-slate-700 dark:text-slate-200 shadow-2xs"
                      >
                        <Clock size={13} className="text-lime-600" />
                        <span>{shift}</span>
                        <button aria-label="Remove Shift" 
                          type="button" 
                          onClick={() => handleRemoveShift(shift)}
                          className="text-slate-400 hover:text-rose-500 transition-colors ml-1 cursor-pointer"
                          title="Remove Shift"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* 2. DISPLAY & SIZING */}
            {activeTab === 'display' && (
              <div className="space-y-6 animate-in fade-in slide-in-from-right-3 duration-200">
                <SectionHeader 
                  icon={Sliders} 
                  title="Display, Sizing & Theme" 
                  desc="Adjust the user interface scaling for tablets, laptops, and touch screen POS terminals."
                />

                {/* Scale Slider */}
                <div className="p-4 sm:p-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h4 className="font-bold text-xs sm:text-sm text-slate-800 dark:text-slate-200">Interface Zoom Scaling</h4>
                      <p className="text-[11px] sm:text-xs text-slate-400 mt-0.5">Scale all text, buttons, and tables to fit your monitor.</p>
                    </div>
                    <span className="text-xs sm:text-sm font-black text-lime-700 dark:text-lime-300 bg-lime-100 dark:bg-lime-950/60 border border-lime-200 dark:border-lime-800 px-3 py-1 rounded-xl font-mono shrink-0">
                      {zoomScale}%
                    </span>
                  </div>

                  <input 
                    type="range" 
                    min="80" 
                    max="250" 
                    step="5" 
                    value={zoomScale} 
                    onChange={(e) => handleZoomChange(parseInt(e.target.value))} 
                    className="w-full h-2.5 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-lime-600"
                  />

                  <div className="flex flex-wrap gap-1.5 sm:gap-2 pt-1">
                    {[80, 90, 100, 110, 120, 130, 150].map(sz => (
                      <button 
                        key={sz}
                        type="button" 
                        onClick={() => handleZoomChange(sz)}
                        className={`px-2.5 sm:px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                          zoomScale === sz 
                            ? 'bg-lime-600 text-white shadow-xs' 
                            : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100'
                        }`}
                      >
                        {sz}% {sz === 100 ? '(Default)' : ''}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Theme & Auto Collapse */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
                  <div 
                    onClick={toggleTheme}
                    className="p-4 sm:p-5 rounded-xl sm:rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800/40 hover:border-lime-500/50 transition-all cursor-pointer flex items-center justify-between gap-3"
                  >
                    <div>
                      <h5 className="font-bold text-xs sm:text-sm text-slate-800 dark:text-slate-200">Color Palette Theme</h5>
                      <p className="text-[11px] sm:text-xs text-slate-400 mt-0.5">Switch between Daylight and Midnight modes.</p>
                    </div>
                    <div className="flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-700 font-bold text-xs shrink-0">
                      {themeMode === 'light' ? <Sun size={15} className="text-amber-500" /> : <Moon size={15} className="text-slate-200" />}
                      <span className="capitalize">{themeMode}</span>
                    </div>
                  </div>

                  <ToggleRow 
                    label="Auto-Collapse Sidebar" 
                    desc="Automatically shrinks sidebar on desktop to give maximum screen space to POS."
                    checked={sidebarAutoCollapse} 
                    onChange={handleSidebarAutoCollapseChange} 
                  />
                </div>
              </div>
            )}

            {/* 3. ACCOUNTING & LEDGER */}
            {activeTab === 'financial' && (
              <div className="space-y-6 animate-in fade-in slide-in-from-right-3 duration-200">
                <SectionHeader 
                  icon={CreditCard} 
                  title="Accounting Defaults & General Ledger" 
                  desc="Map automatic system entries (POS sales, spot milk purchases, customer receipts) to your Chart of Accounts."
                />

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5">
                  <Card className="p-4 sm:p-5 space-y-3.5 sm:space-y-4">
                    <div className="flex items-center gap-2 text-slate-900 dark:text-white font-bold text-sm border-b border-slate-100 dark:border-slate-800 pb-3">
                      <Wallet size={16} className="text-lime-600" />
                      <span>Primary Cash Drawers & Digital Accounts</span>
                    </div>

                    <InputGroup 
                      label="Default Till / Counter Cash Account" 
                      helpText="Customer Khata cash receipts, POS counter cash sales, aur cash supplier payments ka default account."
                    >
                      <SelectInput 
                        value={settings.financial.defaultCashAccountId} 
                        onChange={v => handleFinancialChange('defaultCashAccountId', v)} 
                        options={accounts.filter(a => a.type === 'Cash' && a.isActive !== false).map(a => ({ id: a.id, label: `${a.name} (${formatCurrency(Number(a.balance || 0))})` }))}
                        placeholder="-- Select Default Cash Account --"
                      />
                    </InputGroup>

                    <InputGroup 
                      label="Default Bank / Digital Wallet" 
                      helpText="Customer Online/Bank receipts, QR sales, aur supplier digital transfers ka default account."
                    >
                      <SelectInput 
                        value={settings.financial.defaultDigitalAccountId} 
                        onChange={v => handleFinancialChange('defaultDigitalAccountId', v)} 
                        options={accounts.filter(a => (a.type === 'Bank' || a.type === 'Wallet') && a.isActive !== false).map(a => ({ id: a.id, label: `${a.name} ${a.bank_name ? `(${a.bank_name})` : ''} (${formatCurrency(Number(a.balance || 0))})` }))}
                        placeholder="-- Select Default Bank/Wallet Account --"
                      />
                    </InputGroup>
                  </Card>

                  <Card className="p-4 sm:p-5 space-y-3.5 sm:space-y-4">
                    <div className="flex items-center gap-2 text-slate-900 dark:text-white font-bold text-sm border-b border-slate-100 dark:border-slate-800 pb-3">
                      <BookOpen size={16} className="text-lime-600" />
                      <span>General Ledger Mapping</span>
                    </div>

                    <InputGroup 
                      label="Primary Sales Revenue Account" 
                      helpText="Main credit revenue account on your Chart of Accounts."
                    >
                      <SelectInput 
                        value={settings.financial.defaultSalesAccount} 
                        onChange={v => handleFinancialChange('defaultSalesAccount', v)} 
                        options={incomeAccounts}
                      />
                    </InputGroup>

                    <InputGroup 
                      label="Procurement / COGS Account" 
                      helpText="Cost of Goods Sold / Raw Material purchase account."
                    >
                      <SelectInput 
                        value={settings.financial.defaultCostOfGoodsSoldAccount} 
                        onChange={v => handleFinancialChange('defaultCostOfGoodsSoldAccount', v)} 
                        options={expenseAccounts}
                      />
                    </InputGroup>
                  </Card>
                </div>

                {/* Enabled Payment Modes */}
                <div className="pt-6 border-t border-slate-100 dark:border-slate-800 space-y-3">
                  <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider flex items-center gap-2">
                    <CheckCircle2 size={15} className="text-lime-600" />
                    <span>Allowed POS Payment Modes</span>
                  </h4>
                  
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3">
                    {['Cash', 'Online', 'Credit', 'Check'].map(mode => {
                      const isEnabled = (settings.financial.enabledPaymentModes || []).includes(mode);
                      return (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => {
                            const current = settings.financial.enabledPaymentModes || ['Cash'];
                            const newModes = current.includes(mode) ? current.filter(m => m !== mode) : [...current, mode];
                            if (newModes.length === 0) return showToast('Kam az kam ek payment mode active hona chahiye', 'warning');
                            handleFinancialChange('enabledPaymentModes', newModes);
                          }}
                          className={`p-3 sm:p-3.5 rounded-2xl border text-xs font-bold flex items-center justify-between transition-all cursor-pointer ${
                            isEnabled
                              ? 'bg-lime-50 dark:bg-lime-950/40 border-lime-400 dark:border-lime-800 text-lime-900 dark:text-lime-200 shadow-2xs'
                              : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400'
                          }`}
                        >
                          <span>{mode} Mode</span>
                          {isEnabled ? <Check size={16} className="text-lime-600" /> : <X size={16} className="text-slate-300" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* 4. SALES & INVOICING */}
            {activeTab === 'sales' && (
              <div className="space-y-6 animate-in fade-in slide-in-from-right-3 duration-200">
                <SectionHeader 
                  icon={FileText} 
                  title="Sales & Invoicing Configuration" 
                  desc="Customize bill numbering prefixes, tax calculation rules, and thermal receipt header/footer."
                />

                <div className="space-y-3">
                  <h4 className="text-sm font-bold text-slate-800 dark:text-slate-200">POS Catalog</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <ToggleRow label="Show POS Search Bar" desc="Show product search at the counter. Turn off for more product space." checked={settings.sales.showPosSearch !== false} onChange={v => handleSalesChange('showPosSearch', v)} />
                    <ToggleRow label="Show POS Product Categories" desc="Show category filters above the products. Turn off to display all categories." checked={settings.sales.showPosCategories !== false} onChange={v => handleSalesChange('showPosCategories', v)} />
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <div className="space-y-4 sm:space-y-5">
                    <InputGroup label="Bill Numbering Prefix" helpText="e.g. INV- results in INV-0001, INV-0002...">
                      <TextInput 
                        value={settings.sales.invoicePrefix} 
                        onChange={e => handleSalesChange('invoicePrefix', e.target.value)} 
                        placeholder="INV-"
                      />
                    </InputGroup>

                    <ToggleRow 
                      label="Enable Sales Tax (GST)" 
                      desc="Calculates and adds tax percentage to counter bills."
                      checked={settings.sales.enableTax} 
                      onChange={v => handleSalesChange('enableTax', v)} 
                    />

                    {settings.sales.enableTax && (
                      <InputGroup label="Default Sales Tax Rate (%)">
                        <div className="relative">
                          <TextInput 
                            type="number" 
                            value={settings.sales.defaultTaxRate} 
                            onChange={e => handleSalesChange('defaultTaxRate', parseFloat(e.target.value) || 0)} 
                          />
                          <Percent size={14} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                        </div>
                      </InputGroup>
                    )}

                    <InputGroup label="Thermal Bill Footer Greeting" helpText="Printed at the very bottom of customer receipts.">
                      <TextInput 
                        value={settings.sales.invoiceFooter} 
                        onChange={e => handleSalesChange('invoiceFooter', e.target.value)} 
                        placeholder="Thank you for choosing Mooco Dairy!"
                      />
                    </InputGroup>
                  </div>

                  {/* Live Thermal Receipt Mockup Preview */}
                  <div className="bg-slate-100 dark:bg-slate-800/60 p-4 sm:p-5 rounded-2xl border border-slate-200 dark:border-slate-700 flex flex-col items-center justify-center overflow-x-auto">
                    <div className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-1.5 text-center">
                      <Printer size={13} />
                      <span>Live 80mm Thermal Receipt Preview</span>
                    </div>

                    <div className="w-full max-w-[270px] sm:max-w-xs bg-white text-slate-900 p-4 rounded-xl shadow-lg border border-slate-200 font-mono text-[11px] space-y-2">
                      <div className="text-center font-bold text-xs pb-1 border-b border-dashed border-slate-300">
                        {settings.general.companyName || 'MOOCO DAIRY FARM'}
                        <div className="text-[9px] font-normal text-slate-500 mt-0.5">{settings.general.address || 'Main Branch'}</div>
                        <div className="text-[9px] font-normal text-slate-500">Tel: {settings.general.phone || '0300-0000000'}</div>
                      </div>

                      <div className="flex justify-between text-[10px] text-slate-500 py-1 border-b border-slate-200">
                        <span>Invoice: {settings.sales.invoicePrefix}0042</span>
                        <span>{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      </div>

                      <div className="space-y-1 py-1 text-[10px]">
                        <div className="flex justify-between">
                          <span>Fresh Buffalo Milk (2L)</span>
                          <span>Rs 440</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Kheer Tub (500g)</span>
                          <span>Rs 350</span>
                        </div>
                      </div>

                      <div className="border-t border-dashed border-slate-300 pt-1 space-y-0.5 text-[11px]">
                        <div className="flex justify-between font-bold">
                          <span>TOTAL</span>
                          <span>Rs 790</span>
                        </div>
                        {settings.sales.enableTax && (
                          <div className="flex justify-between text-[9px] text-slate-500">
                            <span>Tax ({settings.sales.defaultTaxRate}%):</span>
                            <span>Rs {((790 * (settings.sales.defaultTaxRate || 0)) / 100).toFixed(0)}</span>
                          </div>
                        )}
                      </div>

                      <div className="text-center text-[9px] text-slate-500 border-t border-slate-200 pt-2 italic">
                        {settings.sales.invoiceFooter || 'Thank you for your visit!'}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* 5. INVENTORY RULES */}
            {activeTab === 'inventory' && (
              <div className="space-y-6 animate-in fade-in slide-in-from-right-3 duration-200">
                <SectionHeader 
                  icon={Package} 
                  title="Inventory & Stock Rules" 
                  desc="Configure stock thresholds, negative stock prevention, and physical audit policies."
                />

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5">
                  <ToggleRow 
                    label="Allow Negative Stock Sales" 
                    desc="Allows cashiers to punch items even if system stock is 0 kg (prevents counter halt)."
                    checked={settings.inventory.allowNegativeStock} 
                    onChange={v => handleInventoryChange('allowNegativeStock', v)} 
                  />

                  <ToggleRow 
                    label="Batch / Expiry Tracking" 
                    desc="Tracks lot numbers and production timestamps for perishable products."
                    checked={settings.inventory.enableBatchTracking} 
                    onChange={v => handleInventoryChange('enableBatchTracking', v)} 
                  />
                </div>

                <div className="max-w-md space-y-2">
                  <InputGroup 
                    label="Low Stock Warning Limit (Units / Kg)" 
                    helpText="Items below this quantity trigger dashboard badges and re-order alerts."
                  >
                    <TextInput 
                      type="number" 
                      value={settings.inventory.lowStockThreshold} 
                      onChange={e => handleInventoryChange('lowStockThreshold', parseInt(e.target.value) || 0)} 
                    />
                  </InputGroup>
                </div>

                <div className="p-4 rounded-2xl bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200/70 dark:border-blue-900/50 flex items-center gap-3 text-xs text-blue-800 dark:text-blue-200">
                  <Info size={18} className="shrink-0 text-blue-600 dark:text-blue-400" />
                  <p>
                    <strong>Inventory Valuation:</strong> Mooco ERP uses the standard <strong>Weighted Average Cost (WAC)</strong> method for live stock valuation and Cost of Goods Sold (COGS).
                  </p>
                </div>

                {/* Measurement Units Link Card */}
                <div className="p-4 sm:p-5 rounded-2xl bg-gradient-to-r from-lime-50 to-emerald-50 dark:from-slate-800 dark:to-slate-800/60 border border-lime-200 dark:border-slate-700 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-lime-600 text-white flex items-center justify-center shrink-0 shadow-sm shadow-lime-600/20">
                      <Scale size={20} />
                    </div>
                    <div>
                      <h4 className="font-bold text-sm text-slate-800 dark:text-white flex items-center gap-2">
                        Measurement Units System
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-lime-200/80 text-lime-800 dark:bg-lime-900/60 dark:text-lime-300">Pakistani & Metric</span>
                      </h4>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        Manage measurement scales (L, ml, kg, g, pao, maund, packs, cartons) and conversion rates.
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => selectTab('units')}
                    className="px-4 py-2 rounded-xl text-xs font-bold bg-lime-600 hover:bg-lime-700 text-white shadow-sm shadow-lime-600/20 transition-all shrink-0 cursor-pointer flex items-center gap-1.5 active:scale-95"
                  >
                    Configure Units <ArrowRight size={14} />
                  </button>
                </div>
              </div>
            )}

            {/* 6. MEASUREMENT UNITS TAB */}
            {activeTab === 'units' && (
              <div className="space-y-6 animate-in fade-in slide-in-from-right-3 duration-200">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <SectionHeader 
                    icon={Scale} 
                    title="Measurement Units System" 
                    desc="Configure metric and Pakistani dairy units (Liter, kg, pao, maund, dozen, packs). Set conversion factors for automated stock tracking and POS billing."
                    badge="Multi-Scale System"
                  />
                  <button
                    type="button"
                    onClick={() => setIsUnitManagerModalOpen(true)}
                    className="px-4 py-2.5 rounded-xl bg-lime-600 hover:bg-lime-700 text-white text-xs sm:text-sm font-bold shadow-md shadow-lime-600/20 flex items-center gap-2 shrink-0 transition-all active:scale-95 cursor-pointer self-start sm:self-auto"
                  >
                    <Plus size={16} />
                    <span>Manage & Add Units</span>
                  </button>
                </div>

                {/* Summary Metrics */}
                {(() => {
                  const allCurrentUnits = getAllAvailableUnits(settings.inventory?.customUnits || []);
                  const volCount = allCurrentUnits.filter(u => u.type === 'Volume').length;
                  const massCount = allCurrentUnits.filter(u => u.type === 'Mass').length;
                  const countCount = allCurrentUnits.filter(u => u.type === 'Count').length;

                  return (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <div className="p-3.5 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700 shadow-2xs">
                        <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-1">
                          <span className="text-[10px] font-bold uppercase tracking-wider">Total Units</span>
                          <Scale size={14} className="opacity-60" />
                        </div>
                        <p className="text-xl font-black text-slate-800 dark:text-white mt-1">{allCurrentUnits.length}</p>
                        <span className="text-[11px] text-slate-400">All registered scales</span>
                      </div>
                      <div className="p-3.5 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700 shadow-2xs">
                        <div className="flex items-center justify-between text-blue-600 dark:text-blue-400 mb-1">
                          <span className="text-[10px] font-bold uppercase tracking-wider">Volume & Liquids</span>
                          <Droplet size={14} className="opacity-80" />
                        </div>
                        <p className="text-xl font-black text-slate-900 dark:text-white mt-1">{volCount}</p>
                        <span className="text-[11px] text-slate-400">L, ml, Maund-vol, 500ml</span>
                      </div>
                      <div className="p-3.5 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700 shadow-2xs">
                        <div className="flex items-center justify-between text-amber-600 dark:text-amber-400 mb-1">
                          <span className="text-[10px] font-bold uppercase tracking-wider">Weight & Mass</span>
                          <Scale size={14} className="opacity-80" />
                        </div>
                        <p className="text-xl font-black text-slate-900 dark:text-white mt-1">{massCount}</p>
                        <span className="text-[11px] text-slate-400">kg, g, Pao, Maund (40kg)</span>
                      </div>
                      <div className="p-3.5 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700 shadow-2xs">
                        <div className="flex items-center justify-between text-purple-600 dark:text-purple-400 mb-1">
                          <span className="text-[10px] font-bold uppercase tracking-wider">Count & Packaging</span>
                          <Boxes size={14} className="opacity-80" />
                        </div>
                        <p className="text-xl font-black text-slate-900 dark:text-white mt-1">{countCount}</p>
                        <span className="text-[11px] text-slate-400">pcs, pack, dz, box, ctn</span>
                      </div>
                    </div>
                  );
                })()}

                {/* Units Directory Card */}
                <Card className="p-4 sm:p-6 space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                    <div>
                      <h4 className="font-bold text-sm sm:text-base text-slate-800 dark:text-white flex items-center gap-2">
                        <span>Active System & Custom Units Directory</span>
                      </h4>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Measurement units available across Milk Purchase, Production Recipes, Catalog, and POS.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setIsUnitManagerModalOpen(true)}
                      className="text-xs font-bold text-lime-600 dark:text-lime-400 hover:text-lime-700 flex items-center gap-1 cursor-pointer"
                    >
                      <Plus size={14} /> Add New Unit
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {getAllAvailableUnits(settings.inventory?.customUnits || []).map(u => {
                      const isSystem = Boolean(u.isSystem);
                      const TypeIcon = u.type === 'Volume' ? Droplet : u.type === 'Mass' ? Scale : Boxes;
                      const formula = getUnitFactorDescription(u);
                      const usageCount = items.filter(i => (i.unit || '').toLowerCase() === u.symbol.toLowerCase()).length;

                      return (
                        <div 
                          key={u.id}
                          className="p-3.5 rounded-2xl border border-slate-200/80 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-850 flex flex-col justify-between gap-2.5 hover:border-slate-400 dark:hover:border-slate-600 transition-all shadow-2xs"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <div className="flex items-center gap-1.5">
                                <span className="font-bold text-xs sm:text-sm text-slate-900 dark:text-white">
                                  {u.name}
                                </span>
                                {u.urduName && (
                                  <span className="text-[11px] text-slate-400 font-medium font-sans">
                                    ({u.urduName})
                                  </span>
                                )}
                              </div>
                              <p className="text-[10px] text-slate-400 mt-0.5">
                                {u.description || (isSystem ? 'Standard Built-in System Unit' : 'Custom Defined Store Unit')}
                              </p>
                            </div>
                            <span className="font-mono font-bold text-xs px-2 py-0.5 rounded-lg bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700 shadow-2xs">
                              {u.symbol}
                            </span>
                          </div>

                          <div className="flex items-center justify-between pt-2 border-t border-slate-200/60 dark:border-slate-700/60 text-[11px]">
                            <span className="font-mono font-semibold text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
                              <TypeIcon size={12} className="text-slate-400" />
                              <span>{formula}</span>
                            </span>
                            {usageCount > 0 && (
                              <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 px-1.5 py-0.5 rounded">
                                {usageCount} items
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </Card>
              </div>
            )}

            {/* 6. PRODUCTION SETTINGS */}
            {activeTab === 'production' && (
              <div className="space-y-6 animate-in fade-in slide-in-from-right-3 duration-200">
                <SectionHeader 
                  icon={Factory} 
                  title="Production & Dairy Processing" 
                  desc="Manufacturing parameters, recipe auto-deduction, and wastage handling."
                />

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5">
                  <Card className="p-4 sm:p-5 space-y-3.5 sm:space-y-4">
                    <h4 className="font-bold text-sm text-slate-800 dark:text-slate-200 border-b border-slate-100 dark:border-slate-800 pb-2 flex items-center gap-2">
                      <CheckCircle2 size={16} className="text-lime-600" />
                      <span>Automated Stock Deduction</span>
                    </h4>
                    <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                      Jab bhi koi cooking ya packing batch <strong>"Completed"</strong> mark hoga, raw milk tank aur packaging materials inventory se automatic deduct ho jayenge.
                    </p>
                    <span className="inline-flex px-3 py-1 rounded-full text-xs font-extrabold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200">
                      Active (Real-time Sync)
                    </span>
                  </Card>

                  <Card className="p-4 sm:p-5 space-y-3.5 sm:space-y-4">
                    <h4 className="font-bold text-sm text-slate-800 dark:text-slate-200 border-b border-slate-100 dark:border-slate-800 pb-2 flex items-center gap-2">
                      <AlertTriangle size={16} className="text-amber-500" />
                      <span>Production Wastage & Spoilage</span>
                    </h4>
                    <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                      Cooking process ke doran jo boiling loss ya spoilage hota hai wo directly Retail Closing / Production Logs mein track hota hai.
                    </p>
                  </Card>
                </div>
              </div>
            )}

            {/* 7. USERS & ROLES (RBAC) */}
            {activeTab === 'users' && (
              <div className="space-y-8 animate-in fade-in slide-in-from-right-3 duration-200">
                
                {/* Header with Add Actions */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 border-b border-slate-100 dark:border-slate-800 pb-4 sm:pb-5">
                  <div className="flex items-start sm:items-center gap-3 sm:gap-3.5 min-w-0">
                    <div className="w-9 h-9 sm:w-11 sm:h-11 rounded-xl sm:rounded-2xl bg-gradient-to-br from-lime-500 to-lime-600 text-white flex items-center justify-center shadow-md shadow-lime-500/20 shrink-0 mt-0.5 sm:mt-0">
                      <ShieldCheck size={20} className="sm:w-[22px] sm:h-[22px]" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white tracking-tight leading-snug flex flex-wrap items-center gap-1.5 sm:gap-2">
                        <span>Staff Operators & Access Control</span>
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-lime-100 text-lime-800 dark:bg-lime-900/40 dark:text-lime-300 border border-lime-200 shrink-0">
                          {users.length} Users
                        </span>
                      </h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 sm:mt-1 font-medium leading-relaxed">
                        Assign 4-digit PINs, designate staff roles, and configure granular permissions.
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:flex items-center gap-2 sm:gap-2.5 w-full sm:w-auto">
                    <button
                      type="button"
                      onClick={handleOpenAddRole}
                      className="px-3 sm:px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700/60 text-slate-700 dark:text-slate-200 text-xs font-bold flex items-center justify-center gap-1.5 shadow-2xs cursor-pointer transition-colors"
                    >
                      <Plus size={15} />
                      <span className="truncate">New Role</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleOpenAddUser}
                      className="px-3 sm:px-4 py-2 rounded-xl bg-lime-600 hover:bg-lime-500 text-white text-xs font-bold flex items-center justify-center gap-1.5 shadow-sm shadow-lime-600/20 cursor-pointer transition-colors"
                    >
                      <UserPlus size={15} />
                      <span className="truncate">Add Operator</span>
                    </button>
                  </div>
                </div>

                {/* Professional Stats Overview Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
                  <div className="p-3 sm:p-4 rounded-xl sm:rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-800">
                    <div className="text-[10px] sm:text-[11px] font-bold text-slate-400 uppercase tracking-wider">Total Operators</div>
                    <div className="text-lg sm:text-xl font-black text-slate-900 dark:text-white mt-0.5 sm:mt-1">{users.length}</div>
                    <div className="text-[10px] text-slate-500 mt-0.5">Staff logins</div>
                  </div>

                  <div className="p-3 sm:p-4 rounded-xl sm:rounded-2xl bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-200/60 dark:border-emerald-900/40">
                    <div className="text-[10px] sm:text-[11px] font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider">Active Terminals</div>
                    <div className="text-lg sm:text-xl font-black text-emerald-700 dark:text-emerald-300 mt-0.5 sm:mt-1">
                      {users.filter(u => u.is_active).length}
                    </div>
                    <div className="text-[10px] text-emerald-600/80 dark:text-emerald-400/80 mt-0.5">Can login</div>
                  </div>

                  <div className="p-3 sm:p-4 rounded-xl sm:rounded-2xl bg-purple-50/50 dark:bg-purple-950/20 border border-purple-200/60 dark:border-purple-900/40">
                    <div className="text-[10px] sm:text-[11px] font-bold text-purple-700 dark:text-purple-400 uppercase tracking-wider">Configured Roles</div>
                    <div className="text-lg sm:text-xl font-black text-purple-700 dark:text-purple-300 mt-0.5 sm:mt-1">{roles.length}</div>
                    <div className="text-[10px] text-purple-600/80 dark:text-purple-400/80 mt-0.5">Profiles</div>
                  </div>

                  <div className="p-3 sm:p-4 rounded-xl sm:rounded-2xl bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200/60 dark:border-amber-900/40">
                    <div className="text-[10px] sm:text-[11px] font-bold text-amber-700 dark:text-amber-400 uppercase tracking-wider">Super Admin</div>
                    <div className="text-sm sm:text-base font-black text-amber-900 dark:text-amber-200 mt-0.5 sm:mt-1 truncate">
                      {users.find(u => u.role_id === 'role_super_admin')?.name || 'Owner'}
                    </div>
                    <div className="text-[10px] text-amber-600/80 dark:text-amber-400/80 mt-0.5 font-bold">Unique (1 Only)</div>
                  </div>
                </div>

                {/* Operator Users Directory */}
                <div className="space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 sm:gap-3">
                    <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider flex items-center gap-2">
                      <Users size={15} className="text-lime-600" />
                      <span>Registered Staff Operators Directory</span>
                    </h4>

                    {/* Search Bar */}
                    <div className="relative max-w-xs w-full">
                      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        type="text"
                        placeholder="Search operator..."
                        value={userSearchQuery}
                        onChange={e => setUserSearchQuery(e.target.value)}
                        className="w-full pl-8 pr-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-medium text-slate-800 dark:text-slate-100 outline-none focus:border-lime-500 shadow-2xs"
                      />
                    </div>
                  </div>

                  {/* Mobile View: High Clarity User Cards */}
                  <div className="md:hidden space-y-2.5">
                    {filteredUsers.length === 0 ? (
                      <div className="py-8 text-center text-slate-400 text-xs border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl">
                        Koi operator nahi mila.
                      </div>
                    ) : (
                      filteredUsers.map(u => {
                        const roleObj = roles.find(r => r.id === u.role_id);
                        const isSuperAdmin = u.role_id === 'role_super_admin';
                        const isCurrent = currentUser?.id === u.id;

                        return (
                          <div 
                            key={u.id}
                            className="p-3.5 rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xs space-y-2.5"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex items-center gap-2.5 min-w-0">
                                <div className={`w-9 h-9 rounded-xl font-black text-xs flex items-center justify-center shrink-0 shadow-2xs ${
                                  isSuperAdmin 
                                    ? 'bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 border border-purple-200' 
                                    : 'bg-lime-100 dark:bg-lime-900/40 text-lime-800 dark:text-lime-300 border border-lime-200'
                                }`}>
                                  {isSuperAdmin ? <Crown size={15} /> : u.name.slice(0, 2).toUpperCase()}
                                </div>
                                <div className="min-w-0">
                                  <div className="font-bold text-sm text-slate-900 dark:text-white flex items-center gap-1.5 truncate">
                                    <span className="truncate">{u.name}</span>
                                    {isCurrent && (
                                      <span className="shrink-0 px-1.5 py-0.2 rounded-md bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 text-[9px] font-extrabold border border-emerald-200">
                                        YOU
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-[11px] text-slate-400 font-mono truncate">@{u.username}</div>
                                </div>
                              </div>

                              <button
                                type="button"
                                disabled={isSuperAdmin}
                                onClick={() => updateUser(u.id, { is_active: !u.is_active })}
                                className={`px-2.5 py-1 rounded-full text-[10px] font-bold transition-all cursor-pointer shrink-0 disabled:opacity-70 disabled:cursor-not-allowed ${
                                  u.is_active
                                    ? 'bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                                    : 'bg-slate-100 dark:bg-slate-800 text-slate-500 border border-slate-200 dark:border-slate-700'
                                }`}
                              >
                                {u.is_active ? 'Active' : 'Disabled'}
                              </button>
                            </div>

                            <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-100 dark:border-slate-800 text-xs">
                              <div>
                                <span className="text-[10px] text-slate-400 font-bold block mb-0.5">ROLE</span>
                                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-bold border truncate ${
                                  isSuperAdmin
                                    ? 'bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 border-purple-200'
                                    : 'bg-lime-50 dark:bg-lime-950/40 text-lime-800 dark:text-lime-300 border-lime-200'
                                }`}>
                                  {isSuperAdmin ? <Crown size={11} /> : <Shield size={11} />}
                                  <span className="truncate">{roleObj?.name || u.role_id}</span>
                                </span>
                              </div>

                              <div>
                                <span className="text-[10px] text-slate-400 font-bold block mb-0.5">SECURITY PIN</span>
                                <div className="inline-flex items-center gap-1 font-mono font-bold bg-slate-100 dark:bg-slate-800/80 px-2 py-0.5 rounded-lg text-xs text-slate-500 dark:text-slate-400 border border-slate-200/60 dark:border-slate-700">
                                  <Lock size={10} className="text-slate-400" />
                                  <span className="tracking-widest">••••</span>
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                              <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                                {u.phone ? `📞 ${u.phone}` : <span className="italic text-slate-400">No phone</span>}
                              </div>

                              <div className="flex items-center gap-1.5 shrink-0">
                                <button
                                  type="button"
                                  onClick={() => handleOpenEditUser(u)}
                                  className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 text-xs font-bold flex items-center gap-1 cursor-pointer transition-colors"
                                >
                                  <Edit2 size={12} />
                                  <span>Edit</span>
                                </button>
                                {!isSuperAdmin && (
                                  <button
                                    type="button"
                                    onClick={async () => {
                                      if (await confirmAction({
                                        title: `User "${u.name}" delete karein?`,
                                        consequences: ['Yeh user ab login nahi kar sakega.', 'Is ke purane records (sales, payments) waise hi rahenge.', 'Yeh kaam wapas nahi ho sakta.'],
                                      })) {
                                        deleteUser(u.id);
                                      }
                                    }}
                                    aria-label={`User ${u.name} delete karein`}
                                    className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-rose-50 dark:hover:bg-rose-950/40 hover:text-rose-600 text-slate-400 transition-colors cursor-pointer"
                                    title="Delete User"
                                  >
                                    <Trash2 size={13} />
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>

                  {/* Desktop View: Full Table */}
                  <div className="hidden md:block border border-slate-200/90 dark:border-slate-800 rounded-2xl overflow-hidden shadow-xs bg-white dark:bg-slate-900">
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs sm:text-sm">
                        <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                          <tr>
                            <th className="py-3 px-4">Operator Name & User</th>
                            <th className="py-3 px-4">Assigned Role</th>
                            <th className="py-3 px-4 text-center">Security PIN</th>
                            <th className="py-3 px-4">Phone / WhatsApp</th>
                            <th className="py-3 px-4 text-center">Status</th>
                            <th className="py-3 px-4 text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                          {filteredUsers.length === 0 ? (
                            <tr>
                              <td colSpan={6} className="py-8 text-center text-slate-400 text-xs">
                                Koi operator nahi mila.
                              </td>
                            </tr>
                          ) : (
                            filteredUsers.map(u => {
                              const roleObj = roles.find(r => r.id === u.role_id);
                              const isSuperAdmin = u.role_id === 'role_super_admin';
                              const isCurrent = currentUser?.id === u.id;

                              return (
                                <tr key={u.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                                  <td className="py-3.5 px-4">
                                    <div className="flex items-center gap-3">
                                      <div className={`w-8 h-8 rounded-xl font-black text-xs flex items-center justify-center shrink-0 shadow-2xs ${
                                        isSuperAdmin 
                                          ? 'bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 border border-purple-200' 
                                          : 'bg-lime-100 dark:bg-lime-900/40 text-lime-800 dark:text-lime-300 border border-lime-200'
                                      }`}>
                                        {isSuperAdmin ? <Crown size={14} /> : u.name.slice(0, 2).toUpperCase()}
                                      </div>
                                      <div>
                                        <div className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                                          <span>{u.name}</span>
                                          {isCurrent && (
                                            <span className="px-1.5 py-0.2 rounded-md bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 text-[10px] font-extrabold border border-emerald-200">
                                              YOU
                                            </span>
                                          )}
                                        </div>
                                        <div className="text-[11px] text-slate-400 font-mono">@{u.username}</div>
                                      </div>
                                    </div>
                                  </td>

                                  <td className="py-3.5 px-4">
                                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-bold border ${
                                      isSuperAdmin
                                        ? 'bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800'
                                        : 'bg-lime-50 dark:bg-lime-950/40 text-lime-800 dark:text-lime-300 border-lime-200 dark:border-lime-800'
                                    }`}>
                                      {isSuperAdmin ? <Crown size={12} /> : <Shield size={12} />}
                                      <span>{roleObj?.name || u.role_id}</span>
                                    </span>
                                  </td>

                                  {/* Strictly Masked Security PIN */}
                                  <td className="py-3.5 px-4 text-center">
                                    <div className="inline-flex items-center gap-1 font-mono font-bold bg-slate-100 dark:bg-slate-800/80 px-2.5 py-1 rounded-xl text-xs text-slate-500 dark:text-slate-400 border border-slate-200/60 dark:border-slate-700" title="Security PIN (Encrypted & Masked)">
                                      <Lock size={11} className="text-slate-400" />
                                      <span className="tracking-widest">••••</span>
                                    </div>
                                  </td>

                                  <td className="py-3.5 px-4 text-slate-600 dark:text-slate-400 text-xs">
                                    {u.phone || <span className="text-slate-300 dark:text-slate-600 italic">None</span>}
                                  </td>

                                  <td className="py-3.5 px-4 text-center">
                                    <button
                                      type="button"
                                      disabled={isSuperAdmin}
                                      onClick={() => updateUser(u.id, { is_active: !u.is_active })}
                                      className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold transition-all cursor-pointer disabled:opacity-70 disabled:cursor-not-allowed ${
                                        u.is_active
                                          ? 'bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                                          : 'bg-slate-100 dark:bg-slate-800 text-slate-500 border border-slate-200 dark:border-slate-700'
                                      }`}
                                    >
                                      {u.is_active ? 'Active' : 'Disabled'}
                                    </button>
                                  </td>

                                  <td className="py-3.5 px-4 text-right">
                                    <div className="flex items-center justify-end gap-1.5">
                                      <button aria-label="Edit Operator"
                                        type="button"
                                        onClick={() => handleOpenEditUser(u)}
                                        className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition-colors cursor-pointer"
                                        title="Edit Operator"
                                      >
                                        <Edit2 size={14} />
                                      </button>
                                      {!isSuperAdmin && (
                                        <button
                                          type="button"
                                          onClick={async () => {
                                            if (await confirmAction({
                                              title: `User "${u.name}" delete karein?`,
                                              consequences: ['Yeh user ab login nahi kar sakega.', 'Is ke purane records (sales, payments) waise hi rahenge.', 'Yeh kaam wapas nahi ho sakta.'],
                                            })) {
                                              deleteUser(u.id);
                                            }
                                          }}
                                          aria-label={`User ${u.name} delete karein`}
                                          className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-rose-50 dark:hover:bg-rose-950/40 hover:text-rose-600 text-slate-400 transition-colors cursor-pointer"
                                          title="Delete User"
                                        >
                                          <Trash2 size={14} />
                                        </button>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>

                {/* Collapsible Roles & Granular Permissions Breakdown */}
                <div className="space-y-4 pt-6 border-t border-slate-100 dark:border-slate-800">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 sm:gap-3">
                    <div>
                      <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider flex items-center gap-2">
                        <Shield size={15} className="text-lime-600" />
                        <span>Role Permissions & Granular Sub-Access Matrix ({roles.length})</span>
                      </h4>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Inspect view, create, edit, delete, and special action rights for each role.
                      </p>
                    </div>

                    <div className="flex items-center gap-2 self-start sm:self-auto">
                      <button
                        type="button"
                        onClick={() => {
                          const allOpen = roles.every(r => expandedRoleIds[r.id]);
                          const next: Record<string, boolean> = {};
                          roles.forEach(r => { next[r.id] = !allOpen; });
                          setExpandedRoleIds(next);
                        }}
                        className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                      >
                        {roles.every(r => expandedRoleIds[r.id]) ? 'Collapse All' : 'Expand All'}
                      </button>
                    </div>
                  </div>

                  {/* Collapsible Role Cards Accordion */}
                  <div className="space-y-3">
                    {roles.map(role => {
                      const userCount = users.filter(u => u.role_id === role.id).length;
                      const isExpanded = !!expandedRoleIds[role.id];
                      const isSuperAdmin = role.id === 'role_super_admin';

                      // Compute total granular actions allowed
                      let allowedActionCount = 0;
                      GRANULAR_PERMISSION_MODULES.forEach(cat => {
                        cat.modules.forEach(m => {
                          m.actions.forEach(a => {
                            if (isSuperAdmin || role.permissions.includes(m.id as any) || role.permissions.includes(`${m.id}:${a.key}`)) {
                              allowedActionCount++;
                            }
                          });
                        });
                      });

                      return (
                        <div
                          key={role.id}
                          className="border border-slate-200/90 dark:border-slate-800 rounded-2xl overflow-hidden bg-white dark:bg-slate-900 transition-all shadow-2xs"
                        >
                          {/* Role Header Bar (Click to Expand / Collapse) */}
                          <div 
                            onClick={() => toggleRoleExpand(role.id)}
                            className="p-3.5 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors cursor-pointer select-none"
                          >
                            <div className="flex items-start sm:items-center gap-3 min-w-0">
                              <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5 sm:mt-0 ${
                                isSuperAdmin 
                                  ? 'bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300' 
                                  : 'bg-lime-100 dark:bg-lime-900/40 text-lime-800 dark:text-lime-300'
                              }`}>
                                {isSuperAdmin ? <Crown size={18} /> : <Shield size={18} />}
                              </div>

                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                                  <h5 className="font-bold text-sm text-slate-900 dark:text-white truncate">{role.name}</h5>
                                  {role.is_system ? (
                                    <span className="px-1.5 sm:px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 text-[9px] sm:text-[10px] font-bold border border-slate-200 dark:border-slate-700 shrink-0">
                                      System Preset
                                    </span>
                                  ) : (
                                    <span className="px-1.5 sm:px-2 py-0.5 rounded-md bg-lime-100 text-lime-800 dark:bg-lime-900/40 dark:text-lime-300 text-[9px] sm:text-[10px] font-bold border border-lime-200 shrink-0">
                                      Custom Role
                                    </span>
                                  )}
                                </div>
                                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-1">
                                  {role.description || 'Custom role with configured module permissions.'}
                                </p>
                              </div>
                            </div>

                            <div className="flex items-center justify-between sm:justify-end gap-2 sm:gap-3 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-100 dark:border-slate-800">
                              <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                                <span className="text-[10px] sm:text-[11px] font-bold text-slate-500 bg-slate-100 dark:bg-slate-800 px-2 sm:px-2.5 py-1 rounded-lg sm:rounded-xl shrink-0">
                                  {userCount} {userCount === 1 ? 'Operator' : 'Operators'}
                                </span>

                                <span className="text-[10px] sm:text-[11px] font-bold text-lime-700 dark:text-lime-300 bg-lime-50 dark:bg-lime-950/50 border border-lime-200 dark:border-lime-800/80 px-2 sm:px-2.5 py-1 rounded-lg sm:rounded-xl shrink-0">
                                  {isSuperAdmin ? 'Full Access' : `${allowedActionCount} Actions`}
                                </span>
                              </div>

                              <div className="flex items-center gap-1 shrink-0">
                                {!role.is_system && (
                                  <div className="flex items-center gap-1 sm:border-l sm:border-slate-200 dark:sm:border-slate-700 sm:pl-2">
                                    <button aria-label="Edit Role Sub-Permissions"
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleOpenEditRole(role);
                                      }}
                                      className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition-colors cursor-pointer"
                                      title="Edit Role Sub-Permissions"
                                    >
                                      <Edit2 size={13} />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={async (e) => {
                                        e.stopPropagation();
                                        if (await confirmAction({
                                          title: `Role "${role.name}" delete karein?`,
                                          consequences: ['Is role ki permissions hat jayengi.', 'Yeh kaam wapas nahi ho sakta.'],
                                        })) {
                                          deleteRole(role.id);
                                        }
                                      }}
                                      aria-label={`Role ${role.name} delete karein`}
                                      className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-rose-50 text-slate-400 hover:text-rose-600 transition-colors cursor-pointer"
                                      title="Delete Role"
                                    >
                                      <Trash2 size={13} />
                                    </button>
                                  </div>
                                )}

                                <div className="text-slate-400 ml-1">
                                  {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* Collapsible Content: Detailed Module & Granular Sub-Action Breakdown */}
                          {isExpanded && (
                            <div className="p-3.5 sm:p-5 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/20 space-y-4 animate-in slide-in-from-top-2 duration-150">
                              <div className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider flex items-center justify-between flex-wrap gap-2">
                                <span>Granular Module & Sub-Access Rights Breakdown:</span>
                                {isSuperAdmin && (
                                  <span className="text-purple-600 dark:text-purple-400 font-bold normal-case">
                                    👑 Full unrestricted admin access (Create, View, Edit, Delete, Void, Pay)
                                  </span>
                                )}
                              </div>

                              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4">
                                {GRANULAR_PERMISSION_MODULES.map((cat, cIdx) => {
                                  const CategoryIcon = cat.icon;

                                  return (
                                    <div 
                                      key={cIdx} 
                                      className="p-3.5 sm:p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-800/60 space-y-3 shadow-2xs"
                                    >
                                      <div className="flex items-center gap-2 text-xs font-bold text-slate-800 dark:text-slate-200 border-b border-slate-100 dark:border-slate-700/60 pb-2">
                                        <CategoryIcon size={15} className="text-lime-600" />
                                        <span>{cat.category}</span>
                                      </div>

                                      <div className="space-y-2.5">
                                        {cat.modules.map(mod => {
                                          const hasFullMod = isSuperAdmin || role.permissions.includes(mod.id as any);
                                          const grantedActions = isSuperAdmin 
                                            ? mod.actions.map(a => a.key)
                                            : mod.actions.filter(a => hasFullMod || role.permissions.includes(`${mod.id}:${a.key}`)).map(a => a.key);

                                          const isModuleActive = grantedActions.length > 0;

                                          return (
                                            <div 
                                              key={mod.id}
                                              className={`p-2.5 rounded-xl border transition-all ${
                                                isModuleActive
                                                  ? 'bg-slate-50/80 dark:bg-slate-800/40 border-slate-200/90 dark:border-slate-700'
                                                  : 'bg-slate-100/40 dark:bg-slate-900/30 border-slate-200/40 dark:border-slate-800/60 opacity-60'
                                              }`}
                                            >
                                              <div className="flex items-center justify-between text-xs font-bold mb-1.5">
                                                <span className={isModuleActive ? 'text-slate-800 dark:text-slate-200' : 'text-slate-400'}>
                                                  {mod.label}
                                                </span>
                                                {isModuleActive ? (
                                                  <span className="text-[10px] font-bold text-lime-700 dark:text-lime-300">
                                                    {grantedActions.length === mod.actions.length ? 'Full Control' : 'Custom Sub-Access'}
                                                  </span>
                                                ) : (
                                                  <span className="text-[10px] font-medium text-slate-400">
                                                    No Access
                                                  </span>
                                                )}
                                              </div>

                                              <div className="flex flex-wrap gap-1.5">
                                                {mod.actions.map(act => {
                                                  const isGranted = grantedActions.includes(act.key);

                                                  return (
                                                    <span 
                                                      key={act.key}
                                                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-bold border transition-all ${
                                                        isGranted
                                                          ? 'bg-lime-50 dark:bg-lime-950/40 text-lime-900 dark:text-lime-300 border-lime-300 dark:border-lime-800'
                                                          : 'bg-slate-100 dark:bg-slate-800 text-slate-400 border-slate-200 dark:border-slate-700 line-through opacity-60'
                                                      }`}
                                                    >
                                                      {isGranted ? <Check size={10} className="text-lime-600" /> : <X size={10} className="text-slate-300" />}
                                                      <span>{act.badge}</span>
                                                    </span>
                                                  );
                                                })}
                                              </div>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

              </div>
            )}

            {/* 8. DATA & DANGER ZONE */}
            {activeTab === 'data' && (
              <div className="space-y-6 animate-in fade-in slide-in-from-right-3 duration-200">
                <SectionHeader 
                  icon={Database} 
                  title="Data Management & Deletion Hub" 
                  desc="Perform test data wipes, granular module stock resets, or selective ledger clearing."
                  badge="Danger Zone"
                />

                {/* Quick Test Mode Clear */}
                <div className="p-4 sm:p-5 rounded-2xl border border-indigo-200 dark:border-indigo-900 bg-indigo-50/50 dark:bg-indigo-950/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3.5 sm:gap-4">
                  <div className="flex items-center gap-3 sm:gap-3.5">
                    <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center shrink-0 shadow-sm">
                      <RefreshCcw size={18} />
                    </div>
                    <div>
                      <h4 className="font-bold text-xs sm:text-sm text-slate-900 dark:text-white">Test Mode Reset (Clear All Transactions)</h4>
                      <p className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        Wipes all sales bills, purchases, batches & ledger logs, but keeps all Master profiles intact.
                      </p>
                    </div>
                  </div>

                  <button 
                    type="button"
                    onClick={() => {
                      setConfirmConfig({
                        isOpen: true,
                        title: 'Reset All Transactions (Test Mode Clear)?',
                        message: '⚠️ This will clear ALL orders, sales bills, purchases, batches, journal vouchers, and expense logs. All customer and supplier balances will be reset to 0. Master customer profiles, supplier names, product definitions, and bank accounts will be KEPT intact. Are you sure?',
                        actionType: 'clear_transactions'
                      });
                    }} 
                    className="w-full sm:w-auto px-4 py-2.5 sm:py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs shadow-xs transition-all active:scale-95 shrink-0 cursor-pointer text-center"
                  >
                    Reset Transactions
                  </button>
                </div>

                {/* Granular Module Table */}
                <div className="border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden bg-white dark:bg-slate-900">
                  <div className="p-3.5 sm:p-4 bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 sm:gap-3">
                    <div className="flex items-center gap-2">
                      <Trash2 size={16} className="text-rose-600 shrink-0" />
                      <span className="font-bold text-xs sm:text-sm text-slate-800 dark:text-slate-200">
                        Selective Module Data Reset
                      </span>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        type="button"
                        onClick={() => {
                          const allIds = [
                            'stock', 'supplier_ledger', 'customer_ledger', 'purchases', 'sales', 
                            'production', 'suppliers', 'customers', 'items', 'expenses', 
                            'bank_cash', 'accounts_journal', 'retail_closings'
                          ];
                          if (selectedModules.size === allIds.length) {
                            setSelectedModules(new Set());
                          } else {
                            setSelectedModules(new Set(allIds));
                          }
                        }}
                        className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-100 transition-colors cursor-pointer"
                      >
                        {selectedModules.size === 13 ? 'Deselect All' : 'Select All'}
                      </button>

                      {selectedModules.size > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            setConfirmConfig({
                              isOpen: true,
                              title: `Reset ${selectedModules.size} Selected Modules?`,
                              message: `⚠️ CRITICAL WARNING: You have selected ${selectedModules.size} data modules to permanently wipe out.\n\nThis action CANNOT be undone. Are you sure you want to proceed?`,
                              actionType: 'clear_multiple_modules',
                              selectedModuleIds: Array.from(selectedModules)
                            });
                          }}
                          className="px-3.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold shadow-sm transition-all cursor-pointer flex items-center gap-1.5"
                        >
                          <Trash2 size={13} />
                          <span>Reset Selected ({selectedModules.size})</span>
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="divide-y divide-slate-100 dark:divide-slate-800/80">
                    {[
                      { id: 'stock', label: 'Physical & Counter Stock (Reset to 0)', desc: 'Sets all product loose & variant stock to 0 and clears logs.', count: items.reduce((acc, i) => acc + (i.stock || 0), 0).toFixed(0), unit: 'units' },
                      { id: 'supplier_ledger', label: 'Supplier Khata & Ledger Only', desc: 'Resets balances to Rs 0 while preserving supplier profiles.', count: supplierTransactions.length + purchases.length, unit: 'entries' },
                      { id: 'customer_ledger', label: 'Customer Khata & Credit Only', desc: 'Resets balances to Rs 0 while preserving customer profiles.', count: customerTransactions.length + sales.length, unit: 'entries' },
                      { id: 'purchases', label: 'Milk & Material Purchases', desc: 'Wipes all milk collection receipts and material bills.', count: purchases.length + materialPurchases.length, unit: 'bills' },
                      { id: 'sales', label: 'POS Counter Bills & Daily Supply', desc: 'Wipes all customer bills and credit dispatch slips.', count: sales.length + dailySupplyEntries.length, unit: 'bills' },
                      { id: 'production', label: 'Production Batches', desc: 'Wipes all manufacturing and processing history.', count: productionBatches.length, unit: 'batches' },
                      { id: 'suppliers', label: 'Suppliers Directory (Full Wipe)', desc: 'Permanently deletes all supplier profiles & phone numbers.', count: suppliers.length, unit: 'profiles' },
                      { id: 'customers', label: 'Customers Directory (Full Wipe)', desc: 'Permanently deletes all customer profiles & khata.', count: customers.length, unit: 'profiles' },
                      { id: 'items', label: 'Custom Products Master', desc: 'Deletes custom product definitions and variants.', count: items.filter(i => !i.isSystem).length, unit: 'products' },
                      { id: 'expenses', label: 'Expenses & Vendor Khata', desc: 'Wipes all expense vouchers and vendor payouts.', count: expenses.length + expenseVendors.length, unit: 'vouchers' },
                      { id: 'bank_cash', label: 'Bank & Cash Transactions', desc: 'Wipes transactions and resets account balances to 0.', count: bankTransactions.length, unit: 'transactions' },
                      { id: 'accounts_journal', label: 'Journal Entries (JV)', desc: 'Wipes manual accounting journal vouchers.', count: journalEntries.length, unit: 'entries' },
                      { id: 'retail_closings', label: 'Retail Shift Closings', desc: 'Wipes daily counter reconciliation records.', count: retailClosings.length, unit: 'closings' },
                    ].map(mod => {
                      const isChecked = selectedModules.has(mod.id);
                      return (
                        <div 
                          key={mod.id}
                          className={`p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 sm:gap-3 transition-colors ${
                            isChecked ? 'bg-rose-50/40 dark:bg-rose-950/20' : 'hover:bg-slate-50/60 dark:hover:bg-slate-800/30'
                          }`}
                        >
                          <label className="flex items-start sm:items-center gap-3 cursor-pointer flex-1 min-w-0">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => {
                                const next = new Set(selectedModules);
                                if (isChecked) next.delete(mod.id);
                                else next.add(mod.id);
                                setSelectedModules(next);
                              }}
                              className="rounded accent-rose-600 w-4 h-4 shrink-0 mt-0.5 sm:mt-0"
                            />
                            <div className="min-w-0 flex-1">
                              <div className="font-bold text-xs sm:text-sm text-slate-800 dark:text-slate-200">
                                {mod.label}
                              </div>
                              <div className="text-[11px] text-slate-400 mt-0.5 line-clamp-2 sm:truncate">
                                {mod.desc}
                              </div>
                            </div>
                          </label>

                          <div className="flex items-center justify-between sm:justify-end gap-2.5 sm:gap-3 shrink-0 pl-7 sm:pl-0">
                            <span className="text-[10px] sm:text-[11px] font-mono font-bold text-slate-500 bg-slate-100 dark:bg-slate-800 px-2 sm:px-2.5 py-1 rounded-lg">
                              {mod.count} {mod.unit}
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                setConfirmConfig({
                                  isOpen: true,
                                  title: `Reset ${mod.label}?`,
                                  message: `⚠️ WARNING: This will permanently wipe all data for "${mod.label}" (${mod.count} ${mod.unit}). Action cannot be undone.`,
                                  actionType: 'clear_module',
                                  moduleName: mod.id,
                                  displayLabel: mod.label
                                });
                              }}
                              className="px-3 py-1 rounded-lg border border-rose-200 dark:border-rose-800 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-xs font-bold transition-all cursor-pointer"
                            >
                              Reset
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

          </Card>
        </main>
      </div>

      {/* --- ADD / EDIT USER MODAL --- */}
      {userModalOpen && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-white dark:bg-slate-900 rounded-2xl sm:rounded-3xl shadow-2xl w-full max-w-md overflow-hidden border border-slate-200 dark:border-slate-800 animate-in zoom-in-95 duration-200 flex flex-col max-h-[92vh]">
            <div className="p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-800/40 shrink-0">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-xl bg-lime-500 text-white flex items-center justify-center font-bold shrink-0">
                  <UserPlus size={16} />
                </div>
                <h4 className="font-bold text-sm sm:text-base text-slate-900 dark:text-white truncate">
                  {editingUserId ? 'Edit Operator User' : 'Add New Operator User'}
                </h4>
              </div>
              <button
                type="button"
                onClick={() => setUserModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer p-1 rounded-lg shrink-0"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveUser} className="p-4 sm:p-5 space-y-3.5 sm:space-y-4 overflow-y-auto flex-1">
              <InputGroup label="Full Name" required>
                <TextInput
                  placeholder="e.g. Ali Raza"
                  value={userForm.name}
                  onChange={e => setUserForm({ ...userForm, name: e.target.value })}
                  required
                />
              </InputGroup>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <InputGroup label="Username" required>
                  <TextInput
                    placeholder="e.g. ali"
                    value={userForm.username}
                    onChange={e => setUserForm({ ...userForm, username: e.target.value.toLowerCase().replace(/\s+/g, '') })}
                    required
                  />
                </InputGroup>

                <InputGroup label={editingUserId ? '4-Digit PIN Code (blank = unchanged)' : '4-Digit PIN Code'} required={!editingUserId} helpText="Confidential terminal code">
                  <TextInput
                    type="password"
                    maxLength={4}
                    placeholder={editingUserId ? 'Same rehne ke liye khali chhorein' : '••••'}
                    value={userForm.pin}
                    onChange={e => setUserForm({ ...userForm, pin: e.target.value.replace(/\D/g, '') })}
                    required={!editingUserId}
                    className="font-mono text-center tracking-widest font-black"
                  />
                </InputGroup>
              </div>

              {/* Role Selector: Super Admin is EXCLUDED from dropdown */}
              <InputGroup
                label="Assigned Role"
                required
                helpText={editingUserId && userForm.role_id === 'role_super_admin' ? "👑 Super Admin is system owner role" : "Select staff role permissions"}
              >
                {editingUserId && userForm.role_id === 'role_super_admin' ? (
                  <div className="w-full px-3.5 sm:px-4 py-2.5 rounded-xl border border-purple-200 dark:border-purple-800 bg-purple-50/50 dark:bg-purple-950/30 text-xs sm:text-sm font-bold text-purple-900 dark:text-purple-200 flex items-center gap-2">
                    <Crown size={15} className="text-purple-600" />
                    <span>Super Admin / Owner (Locked)</span>
                  </div>
                ) : (
                  <SelectInput
                    value={userForm.role_id}
                    onChange={val => setUserForm({ ...userForm, role_id: val })}
                    options={assignableRoles.map(r => ({ id: r.id, label: r.name }))}
                  />
                )}
              </InputGroup>

              {/* Per-user extra access — structured (main module -> sub actions),
                  no need to create a new role just to grant one more module. */}
              {userForm.role_id !== 'role_super_admin' && (
                <div className="space-y-2">
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                    Extra Access — Module & Sub-Access ({userForm.permissions.length} Extra):
                  </label>
                  <p className="text-[11px] text-slate-400 -mt-1">
                    Grant extra access beyond the user's role. Items tagged <b className="text-lime-600">Role</b> come from the assigned role.
                  </p>
                  <div className="space-y-3 max-h-56 sm:max-h-72 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/40 p-2.5 sm:p-3">
                    {GRANULAR_PERMISSION_MODULES.map((cat, cIdx) => {
                      const CategoryIcon = cat.icon;
                      return (
                        <div key={cIdx} className="rounded-xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900/50 p-2.5 sm:p-3 space-y-2">
                          <div className="flex items-center gap-2 text-[11px] font-black text-slate-800 dark:text-slate-200 border-b border-slate-200/60 dark:border-slate-700/60 pb-1.5">
                            <CategoryIcon size={13} className="text-lime-600" />
                            <span>{cat.category}</span>
                          </div>
                          <div className="space-y-1.5">
                            {cat.modules.map(mod => {
                              const modActionKeys = mod.actions.map(a => `${mod.id}:${a.key}`);
                              const roleFull = roleGrantsFullModule(mod.id);
                              const userFull = userHasFullModule(mod.id);
                              const covered = roleFull || userFull;
                              const roleActionCount = mod.actions.filter(a => roleGrantsAction(mod.id, a.key)).length;
                              const userActionCount = mod.actions.filter(a => userHasAction(mod.id, a.key)).length;
                              const expanded = expandedUserPermModules.has(mod.id);
                              return (
                                <div key={mod.id} className="rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700/70 overflow-hidden">
                                  <div className="flex items-center gap-2 px-2.5 py-2">
                                    <input
                                      type="checkbox"
                                      className="w-3.5 h-3.5 accent-lime-600 shrink-0"
                                      disabled={roleFull}
                                      checked={covered}
                                      onChange={() => toggleUserModuleAccess(mod.id, modActionKeys)}
                                    />
                                    <button
                                      type="button"
                                      onClick={() => toggleUserPermModuleExpand(mod.id)}
                                      className="flex-1 flex items-center gap-1.5 min-w-0 text-left cursor-pointer"
                                    >
                                      {expanded
                                        ? <ChevronDown size={13} className="text-slate-400 shrink-0" />
                                        : <ChevronUp size={13} className="text-slate-400 rotate-180 shrink-0" />}
                                      <span className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate">{mod.label}</span>
                                      {!covered && roleActionCount > 0 && (
                                        <span className="text-[9px] font-black uppercase text-lime-600 shrink-0">Role {roleActionCount}/{mod.actions.length}</span>
                                      )}
                                      {!covered && userActionCount > 0 && (
                                        <span className="text-[9px] font-black uppercase text-sky-600 shrink-0">Extra +{userActionCount}</span>
                                      )}
                                      {roleFull && <span className="ml-auto text-[9px] font-black uppercase text-lime-600 shrink-0">Role</span>}
                                    </button>
                                  </div>
                                  {expanded && (
                                    <div className="px-2.5 pb-2 pt-1.5 grid grid-cols-1 gap-1 border-t border-slate-200/70 dark:border-slate-700/70">
                                      {mod.actions.map(a => {
                                        const roleHas = roleGrantsAction(mod.id, a.key);
                                        const checked = covered || roleHas || userHasAction(mod.id, a.key);
                                        const disabled = covered || roleHas;
                                        return (
                                          <label
                                            key={a.key}
                                            className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-[11px] font-bold ${
                                              disabled
                                                ? 'text-slate-400 cursor-not-allowed'
                                                : 'text-slate-700 dark:text-slate-200 hover:bg-lime-50 dark:hover:bg-lime-950/30 cursor-pointer'
                                            }`}
                                          >
                                            <input
                                              type="checkbox"
                                              className="w-3 h-3 accent-lime-600 shrink-0"
                                              disabled={disabled}
                                              checked={checked}
                                              onChange={() => toggleUserActionAccess(mod.id, a.key)}
                                            />
                                            <span className="truncate">{a.label}</span>
                                            <span className="ml-auto flex items-center gap-1 shrink-0">
                                              {roleHas && <span className="text-[8px] font-black uppercase text-lime-600">Role</span>}
                                              <span className="text-[8px] font-black uppercase rounded-full bg-slate-200/80 dark:bg-slate-700 text-slate-500 dark:text-slate-300 px-1.5 py-0.5">{a.badge}</span>
                                            </span>
                                          </label>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <InputGroup label="Phone / WhatsApp (Optional)">
                <TextInput
                  placeholder="0300-1234567"
                  value={userForm.phone}
                  onChange={e => setUserForm({ ...userForm, phone: e.target.value })}
                />
              </InputGroup>

              <ToggleRow
                label="Account Active"
                desc="Inactive staff cannot unlock the terminal"
                checked={userForm.is_active}
                onChange={val => setUserForm({ ...userForm, is_active: val })}
              />

              <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex gap-2.5 sm:gap-3 shrink-0">
                <button
                  type="button"
                  onClick={() => setUserModalOpen(false)}
                  className="flex-1 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 font-bold text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 rounded-xl bg-lime-600 hover:bg-lime-500 font-bold text-xs text-white shadow-sm shadow-lime-600/20 cursor-pointer"
                >
                  {editingUserId ? 'Update User' : 'Create User'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* --- ADD / EDIT ROLE MODAL WITH GRANULAR SUB-ACCESS --- */}
      {roleModalOpen && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-white dark:bg-slate-900 rounded-2xl sm:rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden border border-slate-200 dark:border-slate-800 animate-in zoom-in-95 duration-200 flex flex-col max-h-[92vh]">
            <div className="p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between shrink-0 bg-slate-50/50 dark:bg-slate-800/40">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-xl bg-lime-500 text-white flex items-center justify-center font-bold shrink-0">
                  <Shield size={16} />
                </div>
                <div className="min-w-0">
                  <h4 className="font-bold text-sm sm:text-base text-slate-900 dark:text-white truncate">
                    {editingRoleId ? 'Edit Role & Granular Permissions' : 'Create Custom Role with Sub-Access'}
                  </h4>
                  <p className="text-[11px] sm:text-xs text-slate-400 mt-0.5 truncate">
                    Select exactly what this role can View, Create, Edit, or Delete.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setRoleModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer p-1 rounded-lg shrink-0"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveRole} className="p-4 sm:p-5 space-y-3.5 sm:space-y-4 overflow-y-auto flex-1">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <InputGroup label="Role Title *" required>
                  <TextInput
                    placeholder="e.g. Sales Assistant"
                    value={roleForm.name}
                    onChange={e => setRoleForm({ ...roleForm, name: e.target.value })}
                    required
                  />
                </InputGroup>

                <InputGroup label="Role Description">
                  <TextInput
                    placeholder="e.g. Can view khata but cannot delete"
                    value={roleForm.description}
                    onChange={e => setRoleForm({ ...roleForm, description: e.target.value })}
                  />
                </InputGroup>
              </div>

              {/* Granular Permissions Section */}
              <div className="space-y-3 pt-2">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-2">
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                    Module & Sub-Access Rights ({roleForm.permissions.length} Selected):
                  </label>
                  
                  {/* Global Presets */}
                  <div className="flex items-center gap-2 text-[11px] font-bold flex-wrap">
                    <button
                      type="button"
                      onClick={() => {
                        const allKeys: string[] = [];
                        GRANULAR_PERMISSION_MODULES.forEach(cat => {
                          cat.modules.forEach(m => {
                            m.actions.forEach(a => allKeys.push(`${m.id}:${a.key}`));
                          });
                        });
                        setRoleForm({ ...roleForm, permissions: allKeys });
                      }}
                      className="text-lime-600 hover:underline cursor-pointer"
                    >
                      Select All
                    </button>
                    <span className="text-slate-300">|</span>
                    <button
                      type="button"
                      onClick={() => {
                        const viewOnlyKeys: string[] = [];
                        GRANULAR_PERMISSION_MODULES.forEach(cat => {
                          cat.modules.forEach(m => {
                            m.actions.filter(a => a.key === 'view').forEach(a => viewOnlyKeys.push(`${m.id}:${a.key}`));
                          });
                        });
                        setRoleForm({ ...roleForm, permissions: viewOnlyKeys });
                      }}
                      className="text-indigo-600 hover:underline cursor-pointer"
                    >
                      View-Only All
                    </button>
                    <span className="text-slate-300">|</span>
                    <button
                      type="button"
                      onClick={() => setRoleForm({ ...roleForm, permissions: [] })}
                      className="text-slate-400 hover:underline cursor-pointer"
                    >
                      Clear
                    </button>
                  </div>
                </div>

                {/* Categories & Granular Module Checkboxes */}
                <div className="space-y-3 sm:space-y-4 max-h-72 sm:max-h-80 overflow-y-auto pr-1">
                  {GRANULAR_PERMISSION_MODULES.map((cat, cIdx) => {
                    const CategoryIcon = cat.icon;

                    return (
                      <div key={cIdx} className="space-y-2 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-3 sm:p-3.5 bg-slate-50/50 dark:bg-slate-800/20">
                        <div className="flex items-center gap-2 text-xs font-black text-slate-800 dark:text-slate-200 border-b border-slate-200/60 dark:border-slate-700/60 pb-2">
                          <CategoryIcon size={15} className="text-lime-600" />
                          <span>{cat.category}</span>
                        </div>

                        <div className="grid grid-cols-1 gap-2.5">
                          {cat.modules.map(mod => {
                            const modActionKeys = mod.actions.map(a => `${mod.id}:${a.key}`);
                            const grantedCount = modActionKeys.filter(k => roleForm.permissions.includes(k)).length;
                            const isAllSelected = grantedCount === modActionKeys.length;

                            return (
                              <div 
                                key={mod.id}
                                className="p-2.5 sm:p-3 rounded-xl bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/80 space-y-2 shadow-2xs"
                              >
                                <div className="flex items-center justify-between gap-2 flex-wrap">
                                  <span className="font-bold text-xs text-slate-900 dark:text-white">
                                    {mod.label}
                                  </span>

                                  {/* Quick Mod Presets */}
                                  <div className="flex items-center gap-1.5 text-[9px] sm:text-[10px] font-bold">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const next = new Set(roleForm.permissions);
                                        if (isAllSelected) {
                                          modActionKeys.forEach(k => next.delete(k));
                                        } else {
                                          modActionKeys.forEach(k => next.add(k));
                                        }
                                        setRoleForm({ ...roleForm, permissions: Array.from(next) });
                                      }}
                                      className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-700 hover:bg-lime-100 hover:text-lime-800 text-slate-600 dark:text-slate-300 transition-colors"
                                    >
                                      {isAllSelected ? 'Unselect' : 'All'}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const next = new Set(roleForm.permissions);
                                        modActionKeys.forEach(k => next.delete(k));
                                        next.add(`${mod.id}:view`);
                                        setRoleForm({ ...roleForm, permissions: Array.from(next) });
                                      }}
                                      className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-700 hover:bg-indigo-100 hover:text-indigo-800 text-slate-600 dark:text-slate-300 transition-colors"
                                    >
                                      View Only
                                    </button>
                                  </div>
                                </div>

                                {/* Granular Action Checkboxes */}
                                <div className="flex flex-wrap gap-1.5 sm:gap-2">
                                  {mod.actions.map(act => {
                                    const actionFullKey = `${mod.id}:${act.key}`;
                                    const isChecked = roleForm.permissions.includes(actionFullKey);

                                    return (
                                      <label
                                        key={act.key}
                                        className={`flex items-center gap-1.5 px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-xl border text-[11px] sm:text-xs font-semibold cursor-pointer transition-all select-none ${
                                          isChecked
                                            ? 'bg-lime-50 dark:bg-lime-950/40 border-lime-400 dark:border-lime-800 text-lime-900 dark:text-lime-200 shadow-2xs'
                                            : 'bg-slate-50 dark:bg-slate-900/60 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                                        }`}
                                      >
                                        <input
                                          type="checkbox"
                                          checked={isChecked}
                                          onChange={() => {
                                            const next = new Set(roleForm.permissions);
                                            if (isChecked) {
                                              next.delete(actionFullKey);
                                            } else {
                                              next.add(actionFullKey);
                                              // Auto-add view permission if adding any action
                                              next.add(`${mod.id}:view`);
                                            }
                                            setRoleForm({ ...roleForm, permissions: Array.from(next) });
                                          }}
                                          className="rounded accent-lime-600 w-3.5 h-3.5"
                                        />
                                        <span>{act.label}</span>
                                      </label>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex gap-2.5 sm:gap-3 shrink-0">
                <button
                  type="button"
                  onClick={() => setRoleModalOpen(false)}
                  className="flex-1 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 font-bold text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 rounded-xl bg-lime-600 hover:bg-lime-500 font-bold text-xs text-white shadow-sm shadow-lime-600/20 cursor-pointer"
                >
                  {editingRoleId ? 'Update Role & Sub-Access' : 'Create Role'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* --- CONFIRMATION MODAL --- */}
      {confirmConfig.isOpen && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs">
          <div className="relative bg-white dark:bg-slate-900 rounded-2xl sm:rounded-3xl shadow-2xl w-full max-w-md p-4 sm:p-6 animate-in zoom-in-95 duration-200 overflow-hidden border border-slate-200 dark:border-slate-800">
            <div className="flex flex-col items-center text-center">
              <div className="w-11 h-11 sm:w-12 sm:h-12 bg-rose-100 dark:bg-rose-950/60 text-rose-600 rounded-2xl flex items-center justify-center mb-3 sm:mb-4">
                <AlertTriangle size={24} />
              </div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white mb-2">{confirmConfig.title}</h3>
              <p className="text-slate-500 dark:text-slate-400 text-xs sm:text-sm mb-5 sm:mb-6 whitespace-pre-line leading-relaxed">
                {confirmConfig.message}
              </p>
              <div className="flex gap-2.5 sm:gap-3 w-full">
                <button 
                  onClick={() => setConfirmConfig({ ...confirmConfig, isOpen: false })}
                  className="flex-1 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 font-bold text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button 
                  onClick={async () => {
                     setConfirmConfig(prev => ({ ...prev, isOpen: false }));
                     try {
                        if (confirmConfig.actionType === 'reset_system') {
                           await resetSystem();
                        } else if (confirmConfig.actionType === 'clear_transactions') {
                           await clearData('transactions');
                        } else if (confirmConfig.actionType === 'clear_module' && confirmConfig.moduleName) {
                           await clearData(confirmConfig.moduleName);
                        } else if (confirmConfig.actionType === 'clear_multiple_modules' && confirmConfig.selectedModuleIds) {
                           await clearData(confirmConfig.selectedModuleIds);
                           setSelectedModules(new Set());
                        }
                     } catch (err) {
                        console.error("Action failed:", err);
                     }
                  }}
                  className="flex-1 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 font-bold text-xs text-white shadow-sm shadow-rose-600/20 cursor-pointer"
                >
                  Yes, Proceed
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Unit Manager Modal */}
      <UnitManagerModal 
        isOpen={isUnitManagerModalOpen} 
        onClose={() => setIsUnitManagerModalOpen(false)} 
      />

    </div>
  );
};

export default Settings;
