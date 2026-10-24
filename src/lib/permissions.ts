// Every permission the role editor offers. Each action here is checked somewhere in the app
// (canPerform(module, action)); a permission that nothing checks must not be listed.

export interface PermissionAction {
  key: string;
  label: string;
}

export interface PermissionModuleDef {
  id: string;
  label: string;
  actions: PermissionAction[];
}

export interface PermissionGroup {
  group: string;
  modules: PermissionModuleDef[];
}

export const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    group: 'Sales & Counter',
    modules: [
      { id: 'pos', label: 'POS Counter', actions: [
        { key: 'view', label: 'Open POS' },
        { key: 'create', label: 'Bill & checkout' },
        { key: 'discount', label: 'Give discount (within limit)' },
      ] },
      { id: 'sales_history', label: 'Sales History', actions: [
        { key: 'view', label: 'View & reprint bills' },
        { key: 'return', label: 'Process returns' },
        { key: 'edit', label: 'Change payment mode' },
      ] },
      { id: 'customer_orders', label: 'Customer Orders', actions: [
        { key: 'view', label: 'View orders' },
        { key: 'create', label: 'Book orders' },
        { key: 'edit', label: 'Edit orders' },
        { key: 'cancel', label: 'Cancel orders' },
      ] },
      { id: 'cash_control', label: 'Shifts & Cash', actions: [
        { key: 'view', label: 'View shifts & cash' },
        { key: 'approve', label: 'Accept cash & close day' },
        { key: 'reopen', label: 'Reopen a closed day' },
      ] },
    ],
  },
  {
    group: 'Milk & Purchases',
    modules: [
      { id: 'purchase', label: 'Milk Intake', actions: [
        { key: 'view', label: 'View intake' },
        { key: 'create', label: 'Record intake' },
        { key: 'delete', label: 'Delete intake' },
      ] },
      { id: 'allocation', label: 'Milk Allocation', actions: [
        { key: 'view', label: 'View allocation' },
        { key: 'create', label: 'Allocate milk' },
      ] },
      { id: 'suppliers', label: 'Suppliers', actions: [
        { key: 'view', label: 'View suppliers & ledgers' },
        { key: 'create', label: 'Add supplier' },
        { key: 'edit', label: 'Edit supplier & rates' },
        { key: 'delete', label: 'Delete supplier' },
        { key: 'payment', label: 'Pay supplier' },
      ] },
    ],
  },
  {
    group: 'Production & Stock',
    modules: [
      { id: 'production', label: 'Production', actions: [
        { key: 'view', label: 'View batches' },
        { key: 'create', label: 'Start batch' },
        { key: 'edit', label: 'Advance / complete / cancel' },
      ] },
      { id: 'items', label: 'Products', actions: [
        { key: 'view', label: 'View products & prices' },
        { key: 'create', label: 'Add product' },
        { key: 'edit', label: 'Edit product & price' },
        { key: 'delete', label: 'Delete product' },
      ] },
      { id: 'inventory', label: 'Inventory', actions: [
        { key: 'view', label: 'View stock' },
        { key: 'edit', label: 'Adjust stock' },
      ] },
    ],
  },
  {
    group: 'Finance',
    modules: [
      { id: 'customers', label: 'Customers', actions: [
        { key: 'view', label: 'View customers & ledgers' },
        { key: 'create', label: 'Add customer' },
        { key: 'edit', label: 'Edit customer' },
        { key: 'delete', label: 'Delete customer' },
        { key: 'payment', label: 'Receive payment' },
      ] },
      { id: 'expenses', label: 'Expenses', actions: [
        { key: 'view', label: 'View expenses' },
        { key: 'create', label: 'Add expense' },
        { key: 'edit', label: 'Edit expense' },
        { key: 'delete', label: 'Delete expense' },
      ] },
      { id: 'bank_cash', label: 'Bank & Cash', actions: [
        { key: 'view', label: 'View balances' },
        { key: 'create', label: 'Deposit, withdraw, transfer' },
      ] },
      { id: 'accounts', label: 'Chart of Accounts', actions: [
        { key: 'view', label: 'View ledger' },
        { key: 'create', label: 'Post journal & edit accounts' },
      ] },
      { id: 'dashboard', label: 'Dashboard', actions: [
        { key: 'view', label: 'View dashboard & profit' },
      ] },
      { id: 'reports', label: 'Reports Centre', actions: [
        { key: 'view', label: 'Open sales, stock & party reports' },
        { key: 'financial', label: 'View profit & financial reports' },
        { key: 'export', label: 'Export, print & share reports' },
      ] },
    ],
  },
  {
    group: 'Admin & Controls',
    modules: [
      { id: 'approvals', label: 'Manager Approvals (PIN)', actions: [
        { key: 'discount', label: 'Approve discount over limit' },
        { key: 'return', label: 'Approve returns' },
      ] },
      { id: 'settings', label: 'Settings', actions: [
        { key: 'view', label: 'Open settings' },
        { key: 'edit', label: 'Change business settings' },
      ] },
      { id: 'user_management', label: 'Users & Roles', actions: [
        { key: 'manage', label: 'Add users & edit roles' },
      ] },
    ],
  },
];

export const ALL_PERMISSION_MODULES = PERMISSION_GROUPS.flatMap(g => g.modules);

export const actionKey = (moduleId: string, action: string) => `${moduleId}:${action}`;

export const ALL_ACTION_KEYS = ALL_PERMISSION_MODULES.flatMap(m => m.actions.map(a => actionKey(m.id, a.key)));

/** Turns stored permissions (a full module like 'pos' or single actions like 'pos:view') into action keys. */
export function expandPermissions(perms: string[]): Set<string> {
  const out = new Set<string>();
  perms.forEach(p => {
    const module = ALL_PERMISSION_MODULES.find(m => m.id === p);
    if (module) module.actions.forEach(a => out.add(actionKey(module.id, a.key)));
    else if (p === 'retail_stock') out.add('cash_control:view');
    else out.add(p);
  });
  return out;
}
