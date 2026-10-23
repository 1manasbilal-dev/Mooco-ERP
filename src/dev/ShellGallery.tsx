import React, { useCallback, useState } from 'react';
import { Bell, Bug, CheckCircle2, Lock, ShieldCheck, Users } from 'lucide-react';
import { ToastProvider, useToast } from '../context/ToastContext';
import type { AppUser } from '../types';
import { SidebarView } from '../components/Sidebar';
import { AppHeader, HeaderUserMenuView } from '../components/shell/AppHeader';
import type { ThemeMode } from '../components/shell/preferences';
import { LockScreen } from '../components/UserSwitcherModal';
import ToastContainer from '../components/ToastContainer';
import { RichSelect, type RichSelectOption } from '../components/RichSelect';
import { SmartNumberInput } from '../components/SmartNumberInput';
import { PageLoadingFallback } from '../components/PageLoadingFallback';
import ErrorBoundary from '../components/ErrorBoundary';
import { Badge, Button, Card, CardBody, CardHeader, LoadMoreRow, confirmAction } from '../components/ui';

/**
 * Dev-only preview of the app shell (sidebar, header, lock screen, toasts, dialogs, shared inputs)
 * with sample data: no login, no database, nothing is saved. Part of /__ui.
 */
const ALL_PAGES = 'dashboard,pos,customer-orders,sales-history,cash-control,purchase,purchase-supplies,purchase-details,allocation,production,inventory,items,customers,suppliers,expenses,bank-cash,accounts,reports';

const SAMPLE_USERS: AppUser[] = [
  { id: 'u1', name: 'Anas Bilal', username: 'anas', role_id: 'role_super_admin', is_active: true },
  { id: 'u2', name: 'Ali Raza', username: 'ali', role_id: 'role_cashier', is_active: true },
  { id: 'u3', name: 'Sana Khan', username: 'sana', role_id: 'role_manager', is_active: true },
  { id: 'u4', name: 'Usman', username: 'usman', role_id: 'role_cashier', is_active: true },
];
const ROLE_NAMES = { role_super_admin: 'Super Admin', role_cashier: 'Cashier', role_manager: 'Manager' };

const CUSTOMER_OPTIONS: RichSelectOption[] = [
  { value: 'c1', label: 'Al Rehman Sweets', subLabel: '0300-1234567 · Lahore', avatarLetter: 'A', badge: { text: 'Rs 48,500', variant: 'red' } },
  { value: 'c2', label: 'Green Valley Cafe', subLabel: '0301-7654321', avatarLetter: 'G', badge: { text: 'Adv 2,600', variant: 'green' } },
  { value: 'c3', label: 'Hassan Bakers', subLabel: 'Kasur', avatarLetter: 'H', badge: { text: 'Clear', variant: 'slate' } },
  { value: 'c4', label: 'Madina Tea Stall', subLabel: 'Walk-in', avatarLetter: 'M' },
  { value: 'c5', label: 'Royal Caterers', subLabel: 'Credit limit reached', avatarLetter: 'R', disabled: true },
];

const PAGE_TITLES: Record<string, [string, string | undefined]> = {
  dashboard: ['Dashboard', undefined],
  pos: ['POS Terminal', 'Counter & Sales'],
  customers: ['Customers Khata', 'Parties & Ledgers'],
  settings: ['Settings', 'System'],
};

const notReal = () => new Promise<{ success: boolean; message?: string }>(resolve =>
  window.setTimeout(() => resolve({ success: false, message: 'Gallery demo: PIN check yahan band hai.' }), 500));

function Crash(): React.ReactNode {
  throw new Error('Sample crash from the gallery');
}

function ShellDemo({ themeMode, toggleTheme }: { themeMode: ThemeMode; toggleTheme: () => void }) {
  const { showToast } = useToast();
  const [activeId, setActiveId] = useState('pos');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [lockOpen, setLockOpen] = useState<null | 'switch' | 'locked'>(null);
  const [customer, setCustomer] = useState('c1');
  const [amount, setAmount] = useState('1200');
  const [visibleRows, setVisibleRows] = useState(3);
  const [crash, setCrash] = useState(false);
  const [crashKey, setCrashKey] = useState(0);

  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  const openDrawer = useCallback(() => setDrawerOpen(true), []);
  const noop = useCallback(() => {}, []);
  const lock = useCallback(() => setLockOpen('locked'), []);
  const [title, section] = PAGE_TITLES[activeId] || [activeId, 'Workspace'];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">App shell</p>
        <h2 className="text-2xl font-bold tracking-tight text-fg">Sidebar, header, lock screen</h2>
        <p className="mt-1 text-sm text-fg-subtle">Live shell components with sample data. Nothing here touches the database.</p>
      </div>

      <div className="relative flex h-[600px] overflow-hidden rounded-card border border-line bg-canvas shadow-e1" data-shell-content-demo>
        <SidebarView
          allowedIds={ALL_PAGES}
          activeId={activeId}
          userName="Anas Bilal"
          roleName="Super Admin"
          canAccessSettings
          canOpenDashboard
          isOpen={drawerOpen}
          onClose={closeDrawer}
          onNavigate={setActiveId}
          onLock={lock}
          onLogout={noop}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <AppHeader
            title={title}
            section={section}
            isSidebarOpen={drawerOpen}
            onOpenSidebar={openDrawer}
            themeMode={themeMode}
            onToggleTheme={toggleTheme}
            onOpenPalette={() => showToast('Quick search opens with Ctrl K in the app', 'info')}
            onHome={() => setActiveId('dashboard')}
            status={<Badge tone="neutral" dot className="h-8 px-2.5 text-xs"><span className="hidden sm:inline">Synced</span></Badge>}
            userMenu={<HeaderUserMenuView userName="Anas Bilal" roleName="Super Admin" themeMode={themeMode} onToggleTheme={toggleTheme} onLock={lock} onLogout={noop} />}
          />
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 md:px-6">
            <PageLoadingFallback message="Loading your workspace" submessage="Fetching current stock and account balances" />
          </div>
        </div>
      </div>

      <section className="grid items-start gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="Lock screen" description="Operator switcher and PIN lock" icon={<Lock />} />
          <CardBody className="flex flex-wrap gap-2">
            <Button variant="secondary" leftIcon={<Users />} onClick={() => setLockOpen('switch')}>Switch user</Button>
            <Button variant="secondary" leftIcon={<Lock />} onClick={() => setLockOpen('locked')}>Locked terminal</Button>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Toasts" description="Success, error, info, warning" icon={<Bell />} />
          <CardBody className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" leftIcon={<CheckCircle2 />} onClick={() => showToast('Sale #1042 saved. Rs 2,500 cash.', 'success')}>Success</Button>
            <Button variant="secondary" size="sm" onClick={() => showToast('Stock kam hai: Doodh 12 L baqi.', 'warning')}>Warning</Button>
            <Button variant="secondary" size="sm" onClick={() => showToast('Sync failed: network unreachable.', 'error')}>Error</Button>
            <Button variant="secondary" size="sm" onClick={() => showToast('Starting background sync...', 'info')}>Info</Button>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Dialogs" description="confirmAction and manager approval" icon={<ShieldCheck />} />
          <CardBody className="flex flex-wrap gap-2">
            <Button
              variant="danger-soft"
              onClick={() => void confirmAction({
                title: 'Customer delete karein?',
                message: 'Al Rehman Sweets ka khata hamesha ke liye hat jayega.',
                consequences: ['48,500 ka due balance bhi hat jayega', 'Purani sales history mein naam rahega'],
              })}
            >
              Danger confirm
            </Button>
            <Button variant="secondary" onClick={() => void confirmAction({ title: 'Shift band karein?', message: 'Drawer count save ho jayega.', tone: 'warning' })}>Warning</Button>
            <Button variant="secondary" onClick={() => void confirmAction({ title: 'Backup ready', message: 'File download ho gayi.', tone: 'info', cancelLabel: null })}>Notice</Button>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="RichSelect" description="Searchable select used across forms" />
          <CardBody className="space-y-3">
            <RichSelect options={CUSTOMER_OPTIONS} value={customer} onChange={setCustomer} placeholder="Customer chunein" />
            <RichSelect compact options={CUSTOMER_OPTIONS.slice(0, 3)} value="" onChange={() => {}} placeholder="Compact, no search" />
            <RichSelect options={CUSTOMER_OPTIONS} value="" onChange={() => {}} placeholder="Disabled" disabled />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="SmartNumberInput" description="Type 500+250*2, press Enter" />
          <CardBody className="space-y-3">
            <SmartNumberInput
              value={amount}
              onChange={setAmount}
              prefixText="Rs"
              className="ds-control h-11 w-full rounded-control border border-line bg-surface px-3 text-base font-semibold tabular-nums text-fg shadow-e1 outline-none focus:border-brand-accent focus:ring-4 focus:ring-ring/20"
            />
            <p className="text-xs text-fg-subtle">Parent value: <span className="font-semibold tabular-nums text-fg">{amount || '—'}</span></p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Page error" description="One page crashes, the shell stays" icon={<Bug />} />
          <CardBody className="space-y-3">
            <Button variant="secondary" onClick={() => { setCrash(true); setCrashKey(key => key + 1); }}>Crash a sample page</Button>
            {crash && (
              <div key={crashKey}>
                <ErrorBoundary variant="page">
                  <Crash />
                </ErrorBoundary>
              </div>
            )}
          </CardBody>
        </Card>
      </section>

      <Card>
        <CardHeader title="LoadMoreRow" description="Pagination row under long lists" />
        <CardBody>
          <ul className="divide-y divide-line rounded-control ring-1 ring-inset ring-line">
            {Array.from({ length: visibleRows }, (_, i) => <li key={i} className="px-4 py-2.5 text-sm text-fg">Entry #{i + 1}</li>)}
          </ul>
          <LoadMoreRow sentinelRef={() => {}} hiddenCount={12 - visibleRows} onShowMore={() => setVisibleRows(rows => Math.min(12, rows + 3))} onShowAll={() => setVisibleRows(12)} />
        </CardBody>
      </Card>

      {lockOpen && (
        <LockScreen
          users={SAMPLE_USERS}
          roleNames={ROLE_NAMES}
          defaultUsername="anas"
          canDismiss={lockOpen === 'switch'}
          locked={lockOpen === 'locked'}
          onClose={() => setLockOpen(null)}
          onSuccess={() => setLockOpen(null)}
          verifyPin={notReal}
          verifyCredentials={notReal}
        />
      )}
      {lockOpen === 'locked' && (
        <Button className="fixed bottom-4 right-4 z-[130]" variant="secondary" onClick={() => setLockOpen(null)}>Close demo lock</Button>
      )}
    </div>
  );
}

export default function ShellGallery({ themeMode, toggleTheme }: { themeMode: ThemeMode; toggleTheme: () => void }) {
  return (
    <ToastProvider>
      <ToastContainer />
      <ShellDemo themeMode={themeMode} toggleTheme={toggleTheme} />
    </ToastProvider>
  );
}
