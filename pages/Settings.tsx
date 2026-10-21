import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, Building2, Database, Eye, Package, Receipt, ShieldCheck, Users, Wallet } from 'lucide-react';
import { useDairy } from '../context/DairyContext';
import { useToast } from '../context/ToastContext';
import { confirmAction } from '../components/ui/ConfirmDialog';
import { SaveBar } from '../components/settings/SettingsUI';
import {
  BusinessTab, OperationsTab, PaymentsTab, SalesTab, SecurityTab, SettingsDraft,
  draftFromSettings, draftToSettings, validateDraft,
} from '../components/settings/SettingsForms';
import { UsersTab } from '../components/settings/UsersTab';
import { DataTab } from '../components/settings/DataTab';

interface SettingsProps {
  onBack?: () => void;
  themeMode?: 'light' | 'dark';
  toggleTheme?: () => void;
}

type TabId = 'business' | 'sales' | 'payments' | 'operations' | 'users' | 'security' | 'data';

const TABS: { id: TabId; label: string; hint: string; icon: React.ElementType; group: string }[] = [
  { id: 'business', label: 'Business Profile', hint: 'Naam, address, NTN', icon: Building2, group: 'Business' },
  { id: 'sales', label: 'Sales & Receipts', hint: 'Bill number, receipt, POS', icon: Receipt, group: 'Business' },
  { id: 'payments', label: 'Payments & Accounts', hint: 'Default cash / bank', icon: Wallet, group: 'Business' },
  { id: 'operations', label: 'Inventory & Milk', hint: 'Stock rule, shifts', icon: Package, group: 'Business' },
  { id: 'users', label: 'Users & Access', hint: 'Staff, roles, permissions', icon: Users, group: 'Access & Safety' },
  { id: 'security', label: 'Security & Controls', hint: 'Lock date, discount, auto-lock', icon: ShieldCheck, group: 'Access & Safety' },
  { id: 'data', label: 'Backup & Data', hint: 'Backup, data delete', icon: Database, group: 'Access & Safety' },
];

// Links from older builds (?tab=company, ?tab=units, ...) land on the tab that now holds that setting.
const LEGACY_TABS: Record<string, TabId> = {
  company: 'business', display: 'business', production: 'business',
  financial: 'payments', inventory: 'operations', units: 'operations',
};

const FORM_TABS: TabId[] = ['business', 'sales', 'payments', 'operations', 'security'];

const Settings: React.FC<SettingsProps> = ({ onBack }) => {
  const { settings, updateSettings, accounts, currentUser, canPerform, hasPermission, getBusinessDate } = useDairy();
  const { showToast } = useToast();
  const location = useLocation();
  const navigate = useNavigate();

  const isOwner = currentUser?.role_id === 'role_super_admin';
  const canEdit = canPerform('settings', 'edit');
  // A user manager without the settings permission only reaches Users & Access.
  const canSeeSettings = hasPermission('settings');
  const visibleTabs = TABS.filter(t =>
    (t.id !== 'users' || hasPermission('user_management')) &&
    (t.id !== 'data' || isOwner) &&
    (canSeeSettings || t.id === 'users')
  );

  const tabFromUrl = (): TabId => {
    const raw = new URLSearchParams(location.search).get('tab') || '';
    const id = (LEGACY_TABS[raw] || raw) as TabId;
    return visibleTabs.some(t => t.id === id) ? id : (visibleTabs[0]?.id || 'business');
  };
  const activeTab = tabFromUrl();
  const selectTab = (id: TabId) => navigate(`/settings?tab=${id}`);

  // One draft for every form tab; nothing is written until "Save changes".
  const saved = useMemo(() => draftFromSettings(settings), [settings]);
  const [draft, setDraft] = useState<SettingsDraft>(saved);
  const [saving, setSaving] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);

  // Settings refreshed from the server while nothing is being edited: show the new values.
  useEffect(() => {
    if (!dirty) setDraft(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const patch = <K extends keyof SettingsDraft>(section: K, value: Partial<SettingsDraft[K]>) =>
    setDraft(prev => ({ ...prev, [section]: { ...prev[section], ...value } }));

  const today = getBusinessDate();

  const save = async () => {
    const problem = validateDraft(draft, today);
    if (problem) return showToast(problem, 'warning');
    const newLock = draft.security.lockDate;
    if (newLock && newLock !== saved.security.lockDate && !(await confirmAction({
      tone: 'warning',
      title: `Books ${newLock} tak band karein?`,
      consequences: [
        `${newLock} aur us se pehle ki koi entry add, edit ya delete nahi ho sakegi.`,
        'Bills, purchases, kharche, payments aur journal sab par lagu hoga.',
        'Baad mein Owner lock date peeche kar sakta hai.',
      ],
      confirmLabel: 'Haan, band karein',
    }))) return;
    setSaving(true);
    const changes = draftToSettings(draft);
    // Security controls are Owner-only (read-only for everyone else): never send a stale copy
    // that could undo the Owner's newer lock date / discount limit.
    if (!isOwner) delete changes.security;
    const ok = await updateSettings(changes);
    setSaving(false);
    if (ok) showToast('Settings save ho gayin.', 'success');
  };

  const readOnlyFor = (tab: TabId) => tab === 'security' ? !isOwner : !canEdit;
  const active = visibleTabs.find(t => t.id === activeTab) || visibleTabs[0];
  const groups = [...new Set(visibleTabs.map(t => t.group))];

  return (
    <div className="min-h-full bg-slate-50 dark:bg-slate-950">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur dark:border-slate-800 dark:bg-slate-900/90">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 md:px-8">
          <button type="button" onClick={onBack} aria-label="Wapas" className="rounded-xl border border-slate-200 p-2 text-slate-600 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
            <ArrowLeft size={18} />
          </button>
          <div className="min-w-0">
            <h1 className="text-lg font-black tracking-tight text-slate-900 dark:text-white">Settings</h1>
            <p className="hidden text-xs text-slate-500 sm:block dark:text-slate-400">Business, staff ki ijazat aur data ki hifazat</p>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-6xl flex-col gap-5 px-4 py-5 md:px-8 lg:flex-row lg:gap-8 lg:py-8">
        {/* Phones & tablets: scrollable tab strip */}
        <nav aria-label="Settings sections" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 scrollbar-hide lg:hidden">
          {visibleTabs.map(t => {
            const Icon = t.icon;
            const on = t.id === active.id;
            return (
              <button key={t.id} type="button" onClick={() => selectTab(t.id)} aria-current={on ? 'page' : undefined}
                className={`flex shrink-0 items-center gap-2 rounded-xl border px-3 py-2 text-xs font-bold transition ${on
                  ? 'border-lime-600 bg-lime-600 text-white'
                  : 'border-slate-200 bg-white text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300'}`}>
                <Icon size={15} /> {t.label}
              </button>
            );
          })}
        </nav>

        {/* Desktop: grouped side menu */}
        <nav aria-label="Settings sections" className="hidden w-60 shrink-0 lg:block">
          <div className="sticky top-24 space-y-5">
            {groups.map(group => (
              <div key={group}>
                <div className="mb-1.5 px-3 text-[11px] font-black uppercase tracking-wider text-slate-400">{group}</div>
                <div className="space-y-0.5">
                  {visibleTabs.filter(t => t.group === group).map(t => {
                    const Icon = t.icon;
                    const on = t.id === active.id;
                    return (
                      <button key={t.id} type="button" onClick={() => selectTab(t.id)} aria-current={on ? 'page' : undefined}
                        className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${on
                          ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:text-white dark:ring-slate-800'
                          : 'text-slate-600 hover:bg-white/70 dark:text-slate-400 dark:hover:bg-slate-900/60'}`}>
                        <Icon size={17} className={on ? 'text-lime-600' : 'text-slate-400'} />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-bold">{t.label}</span>
                          <span className="block truncate text-[11px] text-slate-400">{t.hint}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </nav>

        <main className="min-w-0 flex-1">
          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-5 shadow-xs sm:px-6 md:px-8 md:py-7 dark:border-slate-800 dark:bg-slate-900">
            {FORM_TABS.includes(active.id) && readOnlyFor(active.id) && active.id !== 'security' && (
              <div className="mb-4 flex items-center gap-2 rounded-xl bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                <Eye size={14} /> Aap ye settings dekh sakte hain, badal nahi sakte.
              </div>
            )}
            {active.id === 'business' && <BusinessTab draft={draft} patch={patch} readOnly={readOnlyFor('business')} />}
            {active.id === 'sales' && <SalesTab draft={draft} patch={patch} readOnly={readOnlyFor('sales')} />}
            {active.id === 'payments' && <PaymentsTab draft={draft} patch={patch} readOnly={readOnlyFor('payments')} accounts={accounts} />}
            {active.id === 'operations' && <OperationsTab draft={draft} patch={patch} readOnly={readOnlyFor('operations')} onOpenItems={() => navigate('/items')} />}
            {active.id === 'security' && <SecurityTab draft={draft} patch={patch} readOnly={readOnlyFor('security')} today={today} savedLockDate={saved.security.lockDate} />}
            {active.id === 'users' && <UsersTab />}
            {active.id === 'data' && <DataTab />}
          </div>
          <SaveBar visible={dirty} saving={saving} onSave={save} onDiscard={() => setDraft(saved)} />
        </main>
      </div>
    </div>
  );
};

export default Settings;
