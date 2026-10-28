import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, Building2, Database, Eye, Package, Receipt, ShieldCheck, Users, Wallet } from 'lucide-react';
import { useDairy } from '../context/DairyContext';
import { useToast } from '../context/ToastContext';
import { IconButton, confirmAction } from '../components/ui';
import { cn } from '../lib/cn';
import { Notice, SaveBar } from '../components/settings/SettingsUI';
import {
  BusinessTab, FIELD_TAB, FieldKey, OperationsTab, PaymentsTab, SalesTab, SecurityTab, SettingsDraft,
  draftFromSettings, draftToSettings, validateFields,
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
  { id: 'business', label: 'Business Profile', hint: 'Name, address, NTN', icon: Building2, group: 'Business' },
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
  const savingRef = useRef(false);
  // Problems show as they are typed; an empty required field only after a save attempt.
  const [triedSave, setTriedSave] = useState(false);
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
  // Security fields are Owner-only; nobody else is blocked by (or shown) problems there.
  const errors = useMemo(() => {
    const all = validateFields(draft, today);
    if (!isOwner) (Object.keys(all) as FieldKey[]).forEach(k => { if (FIELD_TAB[k] === 'security') delete all[k]; });
    return all;
  }, [draft, today, isOwner]);
  const shownErrors = useMemo(() => {
    if (triedSave) return errors;
    const rest = { ...errors };
    delete rest.companyName;
    return rest;
  }, [errors, triedSave]);
  const problemCount = Object.keys(errors).length;

  const save = async () => {
    if (savingRef.current) return;
    const first = (Object.keys(errors) as FieldKey[])[0];
    if (first) {
      setTriedSave(true);
      showToast(errors[first]!, 'warning');
      // The problem may sit on another tab: open it so the highlighted field is in view.
      if (FIELD_TAB[first] !== activeTab && visibleTabs.some(t => t.id === FIELD_TAB[first])) selectTab(FIELD_TAB[first]);
      return;
    }
    savingRef.current = true;
    try {
      const newLock = draft.security.lockDate;
      if (isOwner && newLock && newLock !== saved.security.lockDate && !(await confirmAction({
        tone: 'warning',
        title: `Close the books up to ${newLock}?`,
        consequences: [
          `No entry on or before ${newLock} can be added, edited or deleted.`,
          'This applies to bills, purchases, expenses, payments and journal.',
          'The Owner can move the lock date back later.',
        ],
        confirmLabel: 'Yes, close books',
      }))) return;
      setSaving(true);
      const changes = draftToSettings(draft);
      // Security controls are Owner-only (read-only for everyone else): never send a stale copy
      // that could undo the Owner's newer lock date / discount limit.
      if (!isOwner) delete changes.security;
      const ok = await updateSettings(changes);
      if (ok) { setTriedSave(false); showToast('Settings saved.', 'success'); }
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const discard = () => { setDraft(saved); setTriedSave(false); };

  // Phones: the tab strip scrolls sideways, so bring the open tab into view.
  const stripRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const strip = stripRef.current;
    const current = strip?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!strip || !current || strip.offsetParent === null) return;
    const box = strip.getBoundingClientRect();
    const pill = current.getBoundingClientRect();
    if (pill.left < box.left || pill.right > box.right) strip.scrollLeft += pill.left - box.left - 16;
  }, [activeTab]);

  const readOnlyFor = (tab: TabId) => tab === 'security' ? !isOwner : !canEdit;
  const active = visibleTabs.find(t => t.id === activeTab) || visibleTabs[0];
  const groups = [...new Set(visibleTabs.map(t => t.group))];
  const tabHasProblem = (id: TabId) => (Object.keys(shownErrors) as FieldKey[]).some(k => FIELD_TAB[k] === id);

  return (
    <div className="min-h-full bg-canvas">
      {/* Phones already show "Settings" in the app header right above, so this bar starts at `sm`. */}
      <header className="sticky top-0 z-30 hidden border-b border-line bg-surface sm:block">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 md:px-8">
          <IconButton variant="secondary" icon={<ArrowLeft />} aria-label="Back" onClick={onBack} />
          <div className="min-w-0">
            <h1 className="text-lg font-bold tracking-tight text-fg">Settings</h1>
            <p className="hidden text-xs text-fg-subtle sm:block">Business, staff access and data safety</p>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-6xl flex-col gap-5 px-4 py-5 md:px-8 lg:flex-row lg:gap-8 lg:py-8">
        {/* Phones & tablets: scrollable tab strip */}
        <nav ref={stripRef} aria-label="Settings sections" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 scrollbar-hide lg:hidden">
          {visibleTabs.map(t => {
            const Icon = t.icon;
            const on = t.id === active.id;
            return (
              <button key={t.id} type="button" onClick={() => selectTab(t.id)} aria-current={on ? 'page' : undefined}
                className={cn('relative flex h-10 shrink-0 items-center gap-2 rounded-control px-3 text-[13px] font-semibold ring-1 ring-inset transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  on ? 'bg-brand-soft text-brand-fg ring-brand/30' : 'bg-surface text-fg-muted ring-line hover:text-fg')}>
                <Icon size={15} aria-hidden="true" /> {t.label}
                {tabHasProblem(t.id) && <span className="size-2 rounded-full bg-danger" aria-label="Problem" />}
              </button>
            );
          })}
        </nav>

        {/* Desktop: grouped side menu */}
        <nav aria-label="Settings sections" className="hidden w-60 shrink-0 lg:block">
          <div className="sticky top-24 space-y-5">
            {groups.map(group => (
              <div key={group}>
                <div className="mb-1.5 px-3 text-[11px] font-bold uppercase tracking-wider text-fg-subtle">{group}</div>
                <div className="space-y-0.5">
                  {visibleTabs.filter(t => t.group === group).map(t => {
                    const Icon = t.icon;
                    const on = t.id === active.id;
                    return (
                      <button key={t.id} type="button" onClick={() => selectTab(t.id)} aria-current={on ? 'page' : undefined}
                        className={cn('flex w-full items-center gap-3 rounded-control px-3 py-2.5 text-left transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                          on ? 'bg-surface text-fg shadow-e1 ring-1 ring-inset ring-line' : 'text-fg-muted hover:bg-surface/70 hover:text-fg')}>
                        <Icon size={17} className={on ? 'text-brand-accent' : 'text-fg-faint'} aria-hidden="true" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold">{t.label}</span>
                          <span className="block truncate text-[11px] text-fg-subtle">{t.hint}</span>
                        </span>
                        {tabHasProblem(t.id) && <span className="size-2 shrink-0 rounded-full bg-danger" aria-label="Problem" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </nav>

        <main className="min-w-0 flex-1">
          {FORM_TABS.includes(active.id) && readOnlyFor(active.id) && active.id !== 'security' && (
            <div className="mb-4"><Notice icon={<Eye />}>You can view these settings but not change them.</Notice></div>
          )}
          {active.id === 'business' && <BusinessTab draft={draft} patch={patch} readOnly={readOnlyFor('business')} errors={shownErrors} />}
          {active.id === 'sales' && <SalesTab draft={draft} patch={patch} readOnly={readOnlyFor('sales')} errors={shownErrors} />}
          {active.id === 'payments' && <PaymentsTab draft={draft} patch={patch} readOnly={readOnlyFor('payments')} accounts={accounts} />}
          {active.id === 'operations' && <OperationsTab draft={draft} patch={patch} readOnly={readOnlyFor('operations')} onOpenItems={() => navigate('/items')} />}
          {active.id === 'security' && <SecurityTab draft={draft} patch={patch} readOnly={readOnlyFor('security')} today={today} savedLockDate={saved.security.lockDate} errors={shownErrors} />}
          {active.id === 'users' && <UsersTab />}
          {active.id === 'data' && <DataTab />}
          <SaveBar visible={dirty} saving={saving} problems={problemCount} onSave={save} onDiscard={discard} />
        </main>
      </div>
    </div>
  );
};

export default Settings;
