import React, { useMemo, useRef, useState } from 'react';
import { ChevronDown, Crown, Edit2, Eye, Lock, Plus, Shield, Trash2, UserPlus, Users } from 'lucide-react';
import { useDairy } from '../../context/DairyContext';
import { useToast } from '../../context/ToastContext';
import { AppRole, AppUser } from '../../types';
import { Badge, Button, Card, CardHeader, EmptyState, Field, IconButton, Input, Modal, SearchInput, Select, TBody, TD, TH, THead, TR, confirmAction } from '../ui';
import { cn } from '../../lib/cn';
import { ALL_ACTION_KEYS, ALL_PERMISSION_MODULES, PERMISSION_GROUPS, actionKey, expandPermissions } from '../../lib/permissions';
import { Notice, TabHeader, Toggle } from './SettingsUI';

const SUPER_ADMIN = 'role_super_admin';
const PIN_PATTERN = /^\d{4}$/;

/**
 * One row per module with a chip per action. `locked` actions come from somewhere else (the
 * user's role) and show as granted but cannot be toggled here.
 */
const PermissionMatrix: React.FC<{
  value: Set<string>;
  locked?: Set<string>;
  readOnly?: boolean;
  onChange: (next: Set<string>) => void;
}> = ({ value, locked = new Set(), readOnly, onChange }) => {
  const has = (key: string) => value.has(key) || locked.has(key);
  const toggle = (moduleId: string, key: string) => {
    const next = new Set(value);
    if (next.has(key)) {
      next.delete(key);
      // Without "view" nothing else in the module is reachable.
      if (key === actionKey(moduleId, 'view')) Array.from(next).filter((k: string) => k.startsWith(`${moduleId}:`)).forEach(k => next.delete(k));
    } else {
      next.add(key);
      const view = actionKey(moduleId, 'view');
      if (ALL_ACTION_KEYS.includes(view)) next.add(view);
    }
    onChange(next);
  };
  const toggleModule = (moduleId: string, keys: string[]) => {
    const next = new Set(value);
    const free = keys.filter(k => !locked.has(k));
    const allOn = free.every(k => next.has(k));
    free.forEach(k => (allOn ? next.delete(k) : next.add(k)));
    onChange(next);
  };

  return (
    <div className="space-y-4">
      {PERMISSION_GROUPS.map(group => (
        <div key={group.group}>
          <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-fg-subtle">{group.group}</div>
          <div className="divide-y divide-line overflow-hidden rounded-control ring-1 ring-inset ring-line">
            {group.modules.map(mod => {
              const keys = mod.actions.map(a => actionKey(mod.id, a.key));
              const count = keys.filter(has).length;
              return (
                <div key={mod.id} className="flex flex-col gap-2 p-2.5 sm:flex-row sm:items-start">
                  <button
                    type="button"
                    disabled={readOnly}
                    onClick={() => toggleModule(mod.id, keys)}
                    className="flex w-full shrink-0 items-center justify-between gap-2 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default sm:w-44"
                    title={readOnly ? undefined : 'Sab on / off'}
                  >
                    <span className="text-sm font-semibold text-fg">{mod.label}</span>
                    <span className={cn('text-[11px] font-bold tabular-nums', count === keys.length ? 'text-brand-fg' : count ? 'text-warning-fg' : 'text-fg-faint')}>{count}/{keys.length}</span>
                  </button>
                  <div className="flex flex-wrap gap-1.5">
                    {mod.actions.map(a => {
                      const key = actionKey(mod.id, a.key);
                      const on = has(key);
                      const isLocked = locked.has(key);
                      return (
                        <button
                          key={key}
                          type="button"
                          aria-pressed={on}
                          disabled={readOnly || isLocked}
                          onClick={() => toggle(mod.id, key)}
                          title={isLocked ? 'Role se mila hai' : undefined}
                          className={cn(
                            'rounded-lg px-2.5 py-1 text-xs font-semibold ring-1 ring-inset transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed',
                            on ? 'bg-brand-soft text-brand-fg ring-brand/30' : 'bg-surface text-fg-subtle ring-line hover:ring-line-strong',
                            isLocked && 'opacity-70',
                          )}
                        >
                          {on ? '✓ ' : ''}{a.label}{isLocked ? ' · role' : ''}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
};

const countActions = (role: AppRole) => role.id === SUPER_ADMIN
  ? ALL_ACTION_KEYS.length
  : ALL_ACTION_KEYS.filter(k => expandPermissions(role.permissions.map(String)).has(k)).length;

const RoleModal: React.FC<{ role: AppRole | null; viewOnly: boolean; onClose: () => void }> = ({ role, viewOnly, onClose }) => {
  const { createRole, updateRole, roles } = useDairy();
  const { showToast } = useToast();
  const isSystem = !!role?.is_system;
  const [name, setName] = useState(role?.name || '');
  const [description, setDescription] = useState(role?.description || '');
  const [perms, setPerms] = useState<Set<string>>(() => role ? expandPermissions(role.permissions.map(String)) : new Set(['pos:view', 'pos:create', 'sales_history:view']));
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [tried, setTried] = useState(false);

  const trimmed = name.trim();
  const duplicate = Boolean(trimmed) && roles.some(r => r.id !== role?.id && r.name.trim().toLowerCase() === trimmed.toLowerCase());
  const nameError = !trimmed ? (tried ? 'Role ka naam likhein.' : undefined) : duplicate ? 'Is naam ka role pehle se hai.' : undefined;

  const save = async () => {
    if (savingRef.current) return;
    setTried(true);
    if (!isSystem && (!trimmed || duplicate)) return showToast(!trimmed ? 'Role ka naam likhein' : 'Is naam ka role pehle se hai', 'warning');
    if (perms.size === 0) return showToast('Kam az kam ek permission chunein', 'warning');
    savingRef.current = true;
    setSaving(true);
    try {
      const permissions = ALL_ACTION_KEYS.filter(k => perms.has(k));
      const ok = role
        ? await updateRole(role.id, isSystem ? { permissions } : { name: trimmed, description: description.trim(), permissions })
        : await createRole({ name: trimmed, description: description.trim(), permissions } as any);
      if (ok) onClose();
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      dismissible={!saving}
      title={viewOnly ? role?.name || 'Role' : role ? `Edit role: ${role.name}` : 'Naya role'}
      description={viewOnly ? 'Is role ki permissions.' : 'Chunein ke is role wala staff kya dekh aur kar sakta hai.'}
      footer={viewOnly ? (
        <Button variant="secondary" onClick={onClose}>Band karein</Button>
      ) : <>
        <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button onClick={save} loading={saving}>{saving ? 'Saving…' : role ? 'Save role' : 'Create role'}</Button>
      </>}
    >
      <div className="space-y-4 pb-1">
        {!viewOnly && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Role name" required error={isSystem ? undefined : nameError} hint={isSystem ? 'Built-in role ka naam nahi badalta.' : undefined}>
              {c => <Input {...c} disabled={isSystem} value={name} maxLength={40} onChange={e => setName(e.target.value)} placeholder="Sales Assistant" />}
            </Field>
            <Field label="Description">
              {c => <Input {...c} disabled={isSystem} value={description} maxLength={120} onChange={e => setDescription(e.target.value)} placeholder="Khata dekh sakta hai, delete nahi" />}
            </Field>
          </div>
        )}
        {!viewOnly && (
          <div className="flex flex-wrap items-center gap-1 text-xs">
            <span className="mr-1 font-semibold text-fg-subtle">Jaldi chunein:</span>
            <Button variant="ghost" size="sm" onClick={() => setPerms(new Set(ALL_ACTION_KEYS))}>Sab kuch</Button>
            <Button variant="ghost" size="sm" onClick={() => setPerms(new Set(ALL_PERMISSION_MODULES.flatMap(m => m.actions.some(a => a.key === 'view') ? [actionKey(m.id, 'view')] : [])))}>Sirf dekhna</Button>
            <Button variant="ghost" size="sm" onClick={() => setPerms(new Set())}>Sab hatayein</Button>
          </div>
        )}
        <PermissionMatrix value={perms} readOnly={viewOnly} onChange={setPerms} />
      </div>
    </Modal>
  );
};

const UserModal: React.FC<{ user: AppUser | null; onClose: () => void }> = ({ user, onClose }) => {
  const { roles, users, currentUser, addUser, updateUser } = useDairy();
  const { showToast } = useToast();
  const isOwner = user?.role_id === SUPER_ADMIN;
  // Nobody but the Owner changes their own role, extra access or login: that would be a self-promotion
  // (or a lock-out) with no one else in the loop.
  const isSelf = Boolean(user && currentUser?.id === user.id);
  const actorIsOwner = currentUser?.role_id === SUPER_ADMIN;
  const lockedSelf = isSelf && !actorIsOwner;
  const assignable = roles.filter(r => r.id !== SUPER_ADMIN);
  const [form, setForm] = useState({
    name: user?.name || '',
    username: user?.username || '',
    pin: '',
    role_id: user?.role_id || assignable[0]?.id || 'role_cashier',
    phone: user?.phone || '',
    is_active: user ? user.is_active !== false : true,
  });
  const [extra, setExtra] = useState<Set<string>>(() => expandPermissions((user?.permissions || []).map(String)));
  const [showExtra, setShowExtra] = useState(() => (user?.permissions || []).length > 0);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [tried, setTried] = useState(false);
  const rolePerms = useMemo(() => expandPermissions((roles.find(r => r.id === form.role_id)?.permissions || []).map(String)), [roles, form.role_id]);
  const extraOnly = [...extra].filter(k => ALL_ACTION_KEYS.includes(k) && !rolePerms.has(k));

  const username = form.username.trim();
  const usernameTaken = Boolean(username) && users.some(u => u.id !== user?.id && u.username.trim().toLowerCase() === username.toLowerCase());
  const errors = {
    name: tried && !form.name.trim() ? 'Naam zaroori hai.' : undefined,
    username: usernameTaken ? 'Ye username kisi aur user ka hai.' : tried && !username ? 'Username zaroori hai.' : undefined,
    pin: (tried || form.pin.length === 4) && (!user || form.pin) && !PIN_PATTERN.test(form.pin) ? '4 digit PIN likhein (misal 1234).' : undefined,
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (savingRef.current) return;
    setTried(true);
    if (!form.name.trim()) return showToast('Naam zaroori hai', 'warning');
    if (!username) return showToast('Username zaroori hai', 'warning');
    if (usernameTaken) return showToast('Ye username kisi aur user ka hai', 'warning');
    if ((!user || form.pin) && !PIN_PATTERN.test(form.pin)) return showToast('4 digit PIN likhein (misal 1234)', 'warning');
    savingRef.current = true;
    setSaving(true);
    try {
      const payload: any = { ...form, name: form.name.trim(), username, phone: form.phone.trim(), permissions: isOwner ? [] : extraOnly };
      if (lockedSelf) {
        // Own role, extra access and login state stay exactly as they are.
        delete payload.role_id;
        delete payload.is_active;
        delete payload.permissions;
      }
      const ok = user ? await updateUser(user.id, payload) : await addUser(payload);
      if (ok) onClose();
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size={showExtra ? 'lg' : 'md'}
      dismissible={!saving}
      title={user ? `Edit: ${user.name}` : 'Naya user'}
      description="Har user apne 4 digit PIN se login karta hai."
      footer={<>
        <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button type="submit" form="user-form" loading={saving}>{saving ? 'Saving…' : user ? 'Save user' : 'Create user'}</Button>
      </>}
    >
      <form id="user-form" onSubmit={save} className="space-y-4 pb-1" noValidate>
        <Field label="Poora naam" required error={errors.name}>
          {c => <Input {...c} value={form.name} maxLength={60} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Ali Raza" autoComplete="off" />}
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Username" required error={errors.username}>
            {c => <Input {...c} value={form.username} maxLength={30} onChange={e => setForm({ ...form, username: e.target.value.toLowerCase().replace(/\s+/g, '') })} placeholder="ali" autoComplete="off" autoCapitalize="none" spellCheck={false} />}
          </Field>
          <Field label={user ? 'Naya PIN (khali = wahi)' : 'PIN (4 digit)'} required={!user} error={errors.pin}>
            {c => <Input {...c} type="password" inputMode="numeric" maxLength={4} autoComplete="new-password" className="text-center font-mono tracking-[0.4em]" value={form.pin} onChange={e => setForm({ ...form, pin: e.target.value.replace(/\D/g, '').slice(0, 4) })} placeholder="••••" />}
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Role" required hint={lockedSelf ? 'Apna role khud nahi badal sakte.' : undefined}>
            {c => isOwner ? (
              <div className="flex h-10 items-center gap-2 rounded-control bg-brand-soft px-3.5 text-sm font-bold text-brand-fg ring-1 ring-inset ring-brand/25"><Crown size={14} aria-hidden="true" /> Owner (fixed)</div>
            ) : (
              <Select {...c} value={form.role_id} disabled={lockedSelf} onChange={e => setForm({ ...form, role_id: e.target.value })}>
                {assignable.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Phone (optional)">
            {c => <Input {...c} value={form.phone} maxLength={20} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="0300-1234567" inputMode="tel" autoComplete="off" />}
          </Field>
        </div>
        {!isOwner && !isSelf && (
          <Toggle label="Login active" description="Band karne se user login nahi kar sakega; purana record waise hi rahega." checked={form.is_active} onChange={v => setForm({ ...form, is_active: v })} />
        )}
        {lockedSelf && <Notice icon={<Lock />}>Apna role, extra access aur login khud nahi badal sakte. Owner ya koi aur manager badal sakta hai.</Notice>}
        {!isOwner && !lockedSelf && (
          <div className="rounded-control ring-1 ring-inset ring-line">
            <button type="button" onClick={() => setShowExtra(v => !v)} aria-expanded={showExtra} className="flex w-full items-center justify-between gap-2 rounded-control p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <span>
                <span className="flex items-center gap-2 text-sm font-semibold text-fg">Extra access {extraOnly.length > 0 && <Badge tone="brand">+{extraOnly.length}</Badge>}</span>
                <span className="block text-xs text-fg-subtle">Sirf is user ko role se zyada ijazat dein — naya role banane ki zaroorat nahi.</span>
              </span>
              <ChevronDown size={16} className={cn('shrink-0 text-fg-faint transition-transform duration-150', showExtra && 'rotate-180')} aria-hidden="true" />
            </button>
            {showExtra && <div className="border-t border-line p-3"><PermissionMatrix value={extra} locked={rolePerms} onChange={setExtra} /></div>}
          </div>
        )}
      </form>
    </Modal>
  );
};

export const UsersTab: React.FC = () => {
  const { users, roles, currentUser, updateUser, deleteUser, deleteRole } = useDairy();
  const [query, setQuery] = useState('');
  const [userModal, setUserModal] = useState<{ user: AppUser | null } | null>(null);
  const [roleModal, setRoleModal] = useState<{ role: AppRole | null; viewOnly: boolean } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const actorIsOwner = currentUser?.role_id === SUPER_ADMIN;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = [...users].sort((a, b) => Number(b.role_id === SUPER_ADMIN) - Number(a.role_id === SUPER_ADMIN) || a.name.localeCompare(b.name));
    return q ? list.filter(u => u.name.toLowerCase().includes(q) || u.username.toLowerCase().includes(q) || (u.phone || '').includes(q)) : list;
  }, [users, query]);
  const roleName = (id: string) => roles.find(r => r.id === id)?.name || id;
  const membersByRole = useMemo(() => {
    const map = new Map<string, number>();
    users.forEach(u => map.set(u.role_id, (map.get(u.role_id) || 0) + 1));
    return map;
  }, [users]);

  const withBusy = async (id: string, work: () => Promise<unknown>) => {
    if (busyId) return;
    setBusyId(id);
    try { await work(); } finally { setBusyId(null); }
  };

  const toggleActive = (u: AppUser) => withBusy(u.id, async () => {
    const disabling = u.is_active !== false;
    if (disabling && !(await confirmAction({
      tone: 'warning',
      title: `"${u.name}" ka login band karein?`,
      consequences: ['Ye user login nahi kar sakega.', 'Is ke purane bills aur payments waise hi rahenge.', 'Baad mein Enable se wapas khul sakta hai.'],
      confirmLabel: 'Haan, band karein',
    }))) return;
    await updateUser(u.id, { is_active: !disabling });
  });
  const removeUser = (u: AppUser) => withBusy(u.id, async () => {
    if (await confirmAction({ title: `"${u.name}" ko delete karein?`, consequences: ['Ye user login nahi kar sakega.', 'Is ke purane bills aur payments waise hi rahenge.'] })) await deleteUser(u.id);
  });
  const removeRole = (r: AppRole) => withBusy(r.id, async () => {
    if (await confirmAction({ title: `Role "${r.name}" delete karein?`, consequences: ['Is role ki permissions hat jayengi.'] })) await deleteRole(r.id);
  });

  return (
    <div className="space-y-4">
      <TabHeader
        title="Users & Access"
        description="Kaun login kar sakta hai aur har role kya kar sakta hai."
        action={<Button leftIcon={<UserPlus />} onClick={() => setUserModal({ user: null })}>Add user</Button>}
      />

      <Card>
        <CardHeader title={<>Users <span className="font-semibold tabular-nums text-fg-subtle">({users.length})</span></>} icon={<Users />}
          description="Owner hamesha full access rakhta hai." />
        <div className="px-5 pb-3">
          <SearchInput value={query} onChange={setQuery} placeholder="Naam, username ya phone dhoondein" aria-label="Users dhoondein" className="sm:max-w-xs" />
        </div>
        <div className="overflow-x-auto border-t border-line">
          <table className="w-full border-collapse text-sm">
            <THead className="bg-surface-2 backdrop-blur-none">
              <tr>
                <TH>User</TH>
                <TH>Role</TH>
                <TH className="hidden sm:table-cell">Status</TH>
                <TH className="hidden md:table-cell">Phone</TH>
                <TH className="text-right"><span className="sr-only">Actions</span></TH>
              </tr>
            </THead>
            <TBody>
              {filtered.map(u => {
                const owner = u.role_id === SUPER_ADMIN;
                // Disabling or deleting your own login locks this terminal out mid-session.
                const isSelf = currentUser?.id === u.id;
                // Only the Owner may change the Owner account (the server refuses anyone else too).
                const canEditRow = !owner || actorIsOwner;
                const extras = (u.permissions || []).length;
                const disabled = u.is_active === false;
                const busy = busyId === u.id;
                const status = (
                  <span className="flex flex-wrap gap-1">
                    {disabled ? <Badge tone="danger" dot>Disabled</Badge> : <Badge tone="success" dot>Active</Badge>}
                    {isSelf && <Badge tone="brand">You</Badge>}
                  </span>
                );
                return (
                  <TR key={u.id} className={cn(disabled && 'opacity-70')}>
                    <TD className="py-2.5">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-xl text-xs font-bold', owner ? 'bg-brand text-brand-on' : 'bg-surface-2 text-fg-muted ring-1 ring-inset ring-line')} aria-hidden="true">
                          {owner ? <Crown size={15} /> : u.name.slice(0, 2).toUpperCase()}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate font-semibold text-fg">{u.name}</span>
                          <span className="block truncate font-mono text-xs text-fg-subtle">@{u.username}</span>
                          <span className="mt-1 block sm:hidden">{status}</span>
                        </span>
                      </div>
                    </TD>
                    <TD className="py-2.5">
                      <span className="flex flex-wrap items-center gap-1">
                        <Badge tone={owner ? 'brand' : 'neutral'} icon={owner ? <Crown aria-hidden="true" /> : <Shield aria-hidden="true" />}>{roleName(u.role_id)}</Badge>
                        {extras > 0 && <Badge tone="info">+{extras} extra</Badge>}
                      </span>
                    </TD>
                    <TD className="hidden py-2.5 sm:table-cell">{status}</TD>
                    <TD className="hidden whitespace-nowrap py-2.5 text-fg-muted md:table-cell">{u.phone || <span className="text-fg-faint">—</span>}</TD>
                    <TD className="py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        {!owner && !isSelf && (
                          <Button variant="ghost" size="sm" onClick={() => void toggleActive(u)} loading={busy} disabled={Boolean(busyId) && !busy} className="hidden sm:inline-flex">
                            {disabled ? 'Enable' : 'Disable'}
                          </Button>
                        )}
                        {canEditRow
                          ? <IconButton size="sm" icon={<Edit2 />} aria-label={`${u.name} edit karein`} onClick={() => setUserModal({ user: u })} />
                          : <IconButton size="sm" icon={<Lock />} aria-label="Owner account sirf Owner badal sakta hai" disabled />}
                        {!owner && !isSelf && (
                          <IconButton size="sm" icon={<Trash2 />} aria-label={`${u.name} delete karein`} onClick={() => void removeUser(u)} disabled={Boolean(busyId)} className="hover:bg-danger-soft hover:text-danger-fg" />
                        )}
                      </div>
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </table>
          {filtered.length === 0 && <EmptyState size="compact" icon={<Users />} title="Koi user nahi mila." description={query ? 'Doosra naam ya username try karein.' : undefined} />}
        </div>
      </Card>

      <Card>
        <CardHeader title="Roles" icon={<Shield />} description="Role ki permissions us ke sab users par lagti hain."
          actions={<Button variant="secondary" size="sm" leftIcon={<Plus />} onClick={() => setRoleModal({ role: null, viewOnly: false })}>New role</Button>} />
        <div className="grid gap-3 px-5 pb-5 sm:grid-cols-2">
          {roles.map(r => {
            const owner = r.id === SUPER_ADMIN;
            const members = membersByRole.get(r.id) || 0;
            const actions = countActions(r);
            // Editing the role you hold would let you grant yourself more access.
            const ownRole = !actorIsOwner && currentUser?.role_id === r.id;
            return (
              <Card key={r.id} variant="inset" className="flex flex-col gap-3 p-4">
                <div className="flex items-start gap-3">
                  <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-xl', owner ? 'bg-brand text-brand-on' : 'bg-surface text-fg-muted ring-1 ring-inset ring-line')} aria-hidden="true">
                    {owner ? <Crown size={16} /> : <Shield size={16} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm font-bold text-fg">{r.name}</span>
                      {r.is_system ? <Badge>Built-in</Badge> : <Badge tone="brand">Custom</Badge>}
                      {ownRole && <Badge tone="info">Your role</Badge>}
                    </div>
                    {r.description && <p className="mt-0.5 line-clamp-2 text-xs text-fg-subtle">{r.description}</p>}
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2 border-t border-line pt-3">
                  <span className="text-xs text-fg-subtle">
                    <span className="tabular-nums">{members}</span> {members === 1 ? 'user' : 'users'} · {owner ? 'Full access' : <span className="tabular-nums">{actions}/{ALL_ACTION_KEYS.length} permissions</span>}
                  </span>
                  <div className="flex items-center gap-1">
                    {owner ? (
                      <Badge icon={<Lock aria-hidden="true" />}>Locked</Badge>
                    ) : (
                      <>
                        <IconButton size="sm" icon={<Eye />} aria-label={`${r.name} dekhein`} onClick={() => setRoleModal({ role: r, viewOnly: true })} />
                        {!ownRole && <IconButton size="sm" icon={<Edit2 />} aria-label={`${r.name} edit karein`} onClick={() => setRoleModal({ role: r, viewOnly: false })} />}
                        {!r.is_system && members === 0 && (
                          <IconButton size="sm" icon={<Trash2 />} aria-label={`${r.name} delete karein`} onClick={() => void removeRole(r)} disabled={Boolean(busyId)} className="hover:bg-danger-soft hover:text-danger-fg" />
                        )}
                      </>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      </Card>

      {userModal && <UserModal user={userModal.user} onClose={() => setUserModal(null)} />}
      {roleModal && <RoleModal role={roleModal.role} viewOnly={roleModal.viewOnly} onClose={() => setRoleModal(null)} />}
    </div>
  );
};
