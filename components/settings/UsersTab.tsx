import React, { useMemo, useState } from 'react';
import { ChevronDown, Crown, Edit2, Eye, Plus, Search, Shield, Trash2, UserPlus } from 'lucide-react';
import { useDairy } from '../../context/DairyContext';
import { useToast } from '../../context/ToastContext';
import { AppRole, AppUser } from '../../types';
import { confirmAction } from '../ui/ConfirmDialog';
import { Modal } from '../ui/Modal';
import { ALL_ACTION_KEYS, ALL_PERMISSION_MODULES, PERMISSION_GROUPS, actionKey, expandPermissions } from '../../lib/permissions';
import { Field, PageHeader, Pill, Toggle, buttonClass, inputClass } from './SettingsUI';

const SUPER_ADMIN = 'role_super_admin';

// ---------------------------------------------------------------- permission matrix
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
          <div className="mb-1.5 text-[11px] font-black uppercase tracking-wider text-slate-400">{group.group}</div>
          <div className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-700">
            {group.modules.map(mod => {
              const keys = mod.actions.map(a => actionKey(mod.id, a.key));
              const count = keys.filter(has).length;
              return (
                <div key={mod.id} className="flex flex-col gap-2 p-2.5 sm:flex-row sm:items-start">
                  <button
                    type="button"
                    disabled={readOnly}
                    onClick={() => toggleModule(mod.id, keys)}
                    className="flex w-full shrink-0 items-center justify-between gap-2 text-left sm:w-44 disabled:cursor-default"
                    title={readOnly ? undefined : 'Sab on / off'}
                  >
                    <span className="text-sm font-bold text-slate-800 dark:text-slate-100">{mod.label}</span>
                    <span className={`text-[11px] font-bold ${count === keys.length ? 'text-lime-600' : count ? 'text-amber-600' : 'text-slate-400'}`}>{count}/{keys.length}</span>
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
                          className={`rounded-lg border px-2.5 py-1 text-xs font-semibold transition ${on
                            ? 'border-lime-300 bg-lime-50 text-lime-900 dark:border-lime-800 dark:bg-lime-950/40 dark:text-lime-200'
                            : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400'} ${isLocked ? 'opacity-70' : ''} disabled:cursor-not-allowed`}
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

// ---------------------------------------------------------------- role editor
const RoleModal: React.FC<{ role: AppRole | null; viewOnly: boolean; onClose: () => void }> = ({ role, viewOnly, onClose }) => {
  const { createRole, updateRole } = useDairy();
  const { showToast } = useToast();
  const isSystem = !!role?.is_system;
  const [name, setName] = useState(role?.name || '');
  const [description, setDescription] = useState(role?.description || '');
  const [perms, setPerms] = useState<Set<string>>(() => role ? expandPermissions(role.permissions.map(String)) : new Set(['pos:view', 'pos:create', 'sales_history:view']));
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!name.trim()) return showToast('Role ka naam likhein', 'warning');
    if (perms.size === 0) return showToast('Kam az kam ek permission chunein', 'warning');
    setSaving(true);
    const permissions = ALL_ACTION_KEYS.filter(k => perms.has(k));
    const ok = role
      ? await updateRole(role.id, isSystem ? { permissions } : { name: name.trim(), description: description.trim(), permissions })
      : await createRole({ name: name.trim(), description: description.trim(), permissions } as any);
    setSaving(false);
    if (ok) onClose();
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
        <button type="button" onClick={onClose} className={buttonClass.secondary}>Band karein</button>
      ) : <>
        <button type="button" onClick={onClose} disabled={saving} className={buttonClass.secondary}>Cancel</button>
        <button type="button" onClick={save} disabled={saving} className={buttonClass.primary}>{saving ? 'Saving…' : role ? 'Save role' : 'Create role'}</button>
      </>}
    >
      <div className="space-y-4">
        {!viewOnly && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Role name" required htmlFor="r-name" hint={isSystem ? 'Built-in role ka naam nahi badalta.' : undefined}>
              <input id="r-name" className={inputClass} disabled={isSystem} value={name} onChange={e => setName(e.target.value)} placeholder="Sales Assistant" />
            </Field>
            <Field label="Description" htmlFor="r-desc">
              <input id="r-desc" className={inputClass} disabled={isSystem} value={description} onChange={e => setDescription(e.target.value)} placeholder="Khata dekh sakta hai, delete nahi" />
            </Field>
          </div>
        )}
        {!viewOnly && (
          <div className="flex flex-wrap items-center gap-1 text-xs">
            <span className="mr-1 font-bold text-slate-500">Jaldi chunein:</span>
            <button type="button" className={buttonClass.ghost} onClick={() => setPerms(new Set(ALL_ACTION_KEYS))}>Sab kuch</button>
            <button type="button" className={buttonClass.ghost} onClick={() => setPerms(new Set(ALL_PERMISSION_MODULES.flatMap(m => m.actions.some(a => a.key === 'view') ? [actionKey(m.id, 'view')] : [])))}>Sirf dekhna</button>
            <button type="button" className={buttonClass.ghost} onClick={() => setPerms(new Set())}>Sab hatayein</button>
          </div>
        )}
        <PermissionMatrix value={perms} readOnly={viewOnly} onChange={setPerms} />
      </div>
    </Modal>
  );
};

// ---------------------------------------------------------------- user editor
const UserModal: React.FC<{ user: AppUser | null; onClose: () => void }> = ({ user, onClose }) => {
  const { roles, addUser, updateUser } = useDairy();
  const { showToast } = useToast();
  const isOwner = user?.role_id === SUPER_ADMIN;
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
  const rolePerms = useMemo(() => expandPermissions((roles.find(r => r.id === form.role_id)?.permissions || []).map(String)), [roles, form.role_id]);
  const extraOnly = [...extra].filter(k => ALL_ACTION_KEYS.includes(k) && !rolePerms.has(k));

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.name.trim()) return showToast('Naam zaroori hai', 'warning');
    if (!form.username.trim()) return showToast('Username zaroori hai', 'warning');
    if ((!user || form.pin) && !/^\d{4}$/.test(form.pin)) return showToast('4 digit PIN likhein (misal 1234)', 'warning');
    setSaving(true);
    const payload: any = { ...form, name: form.name.trim(), permissions: isOwner ? [] : extraOnly };
    const ok = user ? await updateUser(user.id, payload) : await addUser(payload);
    setSaving(false);
    if (ok) onClose();
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
        <button type="button" onClick={onClose} disabled={saving} className={buttonClass.secondary}>Cancel</button>
        <button type="submit" form="user-form" disabled={saving} className={buttonClass.primary}>{saving ? 'Saving…' : user ? 'Save user' : 'Create user'}</button>
      </>}
    >
      <form id="user-form" onSubmit={save} className="space-y-4">
        <Field label="Poora naam" required htmlFor="u-name">
          <input id="u-name" className={inputClass} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Ali Raza" />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Username" required htmlFor="u-username">
            <input id="u-username" className={inputClass} value={form.username} onChange={e => setForm({ ...form, username: e.target.value.toLowerCase().replace(/\s+/g, '') })} placeholder="ali" autoComplete="off" />
          </Field>
          <Field label={user ? 'Naya PIN (khali = wahi)' : 'PIN (4 digit)'} required={!user} htmlFor="u-pin">
            <input id="u-pin" type="password" inputMode="numeric" maxLength={4} autoComplete="new-password" className={`${inputClass} text-center font-mono tracking-[0.4em]`} value={form.pin} onChange={e => setForm({ ...form, pin: e.target.value.replace(/\D/g, '') })} placeholder="••••" />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Role" required htmlFor="u-role">
            {isOwner ? (
              <div className="flex items-center gap-2 rounded-xl border border-violet-200 bg-violet-50 px-3.5 py-2.5 text-sm font-bold text-violet-800 dark:border-violet-900 dark:bg-violet-950/30 dark:text-violet-200"><Crown size={14} /> Owner (fixed)</div>
            ) : (
              <select id="u-role" className={inputClass} value={form.role_id} onChange={e => setForm({ ...form, role_id: e.target.value })}>
                {assignable.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            )}
          </Field>
          <Field label="Phone (optional)" htmlFor="u-phone">
            <input id="u-phone" className={inputClass} value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="0300-1234567" inputMode="tel" />
          </Field>
        </div>
        {!isOwner && (
          <Toggle label="Login active" description="Band karne se user login nahi kar sakega; purana record waise hi rahega." checked={form.is_active} onChange={v => setForm({ ...form, is_active: v })} />
        )}
        {!isOwner && (
          <div className="rounded-xl border border-slate-200 dark:border-slate-700">
            <button type="button" onClick={() => setShowExtra(v => !v)} className="flex w-full items-center justify-between gap-2 p-3 text-left">
              <span>
                <span className="block text-sm font-bold text-slate-800 dark:text-slate-100">Extra access {extraOnly.length > 0 && <Pill tone="lime">+{extraOnly.length}</Pill>}</span>
                <span className="block text-xs text-slate-500 dark:text-slate-400">Sirf is user ko role se zyada ijazat dein — naya role banane ki zaroorat nahi.</span>
              </span>
              <ChevronDown size={16} className={`shrink-0 text-slate-400 transition-transform ${showExtra ? 'rotate-180' : ''}`} />
            </button>
            {showExtra && <div className="border-t border-slate-200 p-3 dark:border-slate-700"><PermissionMatrix value={extra} locked={rolePerms} onChange={setExtra} /></div>}
          </div>
        )}
      </form>
    </Modal>
  );
};

// ---------------------------------------------------------------- tab
export const UsersTab: React.FC = () => {
  const { users, roles, currentUser, updateUser, deleteUser, deleteRole } = useDairy();
  const [query, setQuery] = useState('');
  const [userModal, setUserModal] = useState<{ user: AppUser | null } | null>(null);
  const [roleModal, setRoleModal] = useState<{ role: AppRole | null; viewOnly: boolean } | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = [...users].sort((a, b) => Number(b.role_id === SUPER_ADMIN) - Number(a.role_id === SUPER_ADMIN) || a.name.localeCompare(b.name));
    return q ? list.filter(u => u.name.toLowerCase().includes(q) || u.username.toLowerCase().includes(q) || (u.phone || '').includes(q)) : list;
  }, [users, query]);
  const roleName = (id: string) => roles.find(r => r.id === id)?.name || id;

  const removeUser = async (u: AppUser) => {
    if (await confirmAction({ title: `"${u.name}" ko delete karein?`, consequences: ['Ye user login nahi kar sakega.', 'Is ke purane bills aur payments waise hi rahenge.'] })) deleteUser(u.id);
  };
  const removeRole = async (r: AppRole) => {
    if (await confirmAction({ title: `Role "${r.name}" delete karein?`, consequences: ['Is role ki permissions hat jayengi.'] })) deleteRole(r.id);
  };

  return (
    <div>
      <PageHeader
        title="Users & Access"
        description="Kaun login kar sakta hai aur har role kya kar sakta hai."
        action={<button type="button" onClick={() => setUserModal({ user: null })} className={buttonClass.primary}><UserPlus size={15} /> Add user</button>}
      />

      {/* Users */}
      <div className="space-y-3 py-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">Users <span className="font-semibold text-slate-400">({users.length})</span></h3>
          <div className="relative w-full sm:w-64">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Naam ya username dhoondein" aria-label="Users dhoondein" className={`${inputClass} py-2 pl-8`} />
          </div>
        </div>
        <div className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
          {filtered.length === 0 && <p className="p-6 text-center text-sm text-slate-400">Koi user nahi mila.</p>}
          {filtered.map(u => {
            const owner = u.role_id === SUPER_ADMIN;
            const extras = (u.permissions || []).length;
            return (
              <div key={u.id} className="flex items-center gap-3 p-3 sm:px-4">
                <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-xs font-black ${owner ? 'bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300' : 'bg-lime-100 text-lime-800 dark:bg-lime-950/60 dark:text-lime-300'}`}>
                  {owner ? <Crown size={15} /> : u.name.slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="truncate text-sm font-bold text-slate-900 dark:text-white">{u.name}</span>
                    {currentUser?.id === u.id && <Pill tone="lime">You</Pill>}
                    {u.is_active === false && <Pill tone="rose">Disabled</Pill>}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-slate-500 dark:text-slate-400">
                    <span className="font-mono">@{u.username}</span>
                    <span>·</span>
                    <span>{roleName(u.role_id)}{extras > 0 ? ` + ${extras} extra` : ''}</span>
                    {u.phone && <span className="hidden sm:inline">· {u.phone}</span>}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {!owner && (
                    <button type="button" onClick={() => updateUser(u.id, { is_active: u.is_active === false })} className={`${buttonClass.ghost} hidden sm:inline-flex`}>
                      {u.is_active === false ? 'Enable' : 'Disable'}
                    </button>
                  )}
                  <button type="button" aria-label={`${u.name} edit karein`} onClick={() => setUserModal({ user: u })} className={buttonClass.ghost}><Edit2 size={14} /></button>
                  {!owner && <button type="button" aria-label={`${u.name} delete karein`} onClick={() => removeUser(u)} className={`${buttonClass.ghost} hover:text-rose-600`}><Trash2 size={14} /></button>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Roles */}
      <div className="space-y-3 border-t border-slate-100 py-6 dark:border-slate-800/70">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">Roles</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">Role ki permissions us ke sab users par lagti hain.</p>
          </div>
          <button type="button" onClick={() => setRoleModal({ role: null, viewOnly: false })} className={buttonClass.secondary}><Plus size={15} /> New role</button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {roles.map(r => {
            const owner = r.id === SUPER_ADMIN;
            const members = users.filter(u => u.role_id === r.id).length;
            const actions = countActions(r);
            return (
              <div key={r.id} className="flex flex-col gap-3 rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
                <div className="flex items-start gap-3">
                  <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${owner ? 'bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>
                    {owner ? <Crown size={16} /> : <Shield size={16} />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm font-bold text-slate-900 dark:text-white">{r.name}</span>
                      {r.is_system ? <Pill>Built-in</Pill> : <Pill tone="lime">Custom</Pill>}
                    </div>
                    {r.description && <p className="mt-0.5 line-clamp-2 text-xs text-slate-500 dark:text-slate-400">{r.description}</p>}
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    {members} {members === 1 ? 'user' : 'users'} · {owner ? 'Full access' : `${actions}/${ALL_ACTION_KEYS.length} permissions`}
                  </span>
                  <div className="flex items-center gap-1">
                    {owner ? (
                      <span className="text-xs font-semibold text-slate-400">Locked</span>
                    ) : (
                      <>
                        <button type="button" onClick={() => setRoleModal({ role: r, viewOnly: true })} aria-label={`${r.name} dekhein`} className={buttonClass.ghost}><Eye size={14} /></button>
                        <button type="button" onClick={() => setRoleModal({ role: r, viewOnly: false })} aria-label={`${r.name} edit karein`} className={buttonClass.ghost}><Edit2 size={14} /></button>
                        {!r.is_system && members === 0 && <button type="button" onClick={() => removeRole(r)} aria-label={`${r.name} delete karein`} className={`${buttonClass.ghost} hover:text-rose-600`}><Trash2 size={14} /></button>}
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {userModal && <UserModal user={userModal.user} onClose={() => setUserModal(null)} />}
      {roleModal && <RoleModal role={roleModal.role} viewOnly={roleModal.viewOnly} onClose={() => setRoleModal(null)} />}
    </div>
  );
};
