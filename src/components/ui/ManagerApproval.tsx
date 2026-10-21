import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Crown, KeyRound, ShieldCheck } from 'lucide-react';
import { Modal } from './Modal';
import { useDairy } from '../../context/DairyContext';
import { AppRole, AppUser } from '../../types';

export interface ApprovalRequest {
  /** Permission the approver must hold, e.g. 'approvals:discount'. Super Admin always qualifies. */
  permission: string;
  title: string;
  /** One line on what is being approved, e.g. "Discount Rs 450 (18%) — limit 10%". */
  reason: string;
}

/** Whether a user (through their role or their own extra access) may give this approval. */
const canApprove = (user: AppUser, roles: AppRole[], permission: string): boolean => {
  if (user.is_active === false) return false;
  if (user.role_id === 'role_super_admin') return true;
  const module = permission.split(':')[0];
  const perms = [...(user.permissions || []), ...(roles.find(r => r.id === user.role_id)?.permissions || [])].map(String);
  return perms.includes(module) || perms.includes(permission);
};

interface Pending extends ApprovalRequest { resolve: (approverName: string | null) => void }

/**
 * Manager PIN override. `const { requestApproval, approvalDialog } = useManagerApproval();`
 * then render `{approvalDialog}` and `const by = await requestApproval({...}); if (!by) return;`.
 * The PIN is checked on the server; this terminal's signed-in user does not change.
 */
export function useManagerApproval() {
  const { users, roles, currentUser, requestManagerApproval } = useDairy();
  const [pending, setPending] = useState<Pending | null>(null);
  const [approverId, setApproverId] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pinRef = useRef<HTMLInputElement>(null);

  const approvers = useMemo(
    () => (pending ? users.filter(u => u.id !== currentUser?.id && canApprove(u, roles, pending.permission)) : []),
    [pending, users, roles, currentUser?.id]
  );

  const requestApproval = useCallback((request: ApprovalRequest) => new Promise<string | null>(resolve => {
    setApproverId('');
    setPin('');
    setError('');
    setBusy(false);
    setPending({ ...request, resolve });
  }), []);

  const close = (result: string | null) => {
    pending?.resolve(result);
    setPending(null);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!pending || busy) return;
    const chosen = approverId || (approvers.length === 1 ? approvers[0].id : '');
    if (!chosen) return setError('Manager chunein.');
    if (!/^\d{4}$/.test(pin)) return setError('4 digit PIN likhein.');
    setBusy(true);
    setError('');
    const result = await requestManagerApproval(chosen, pin, pending.permission);
    setBusy(false);
    if (!result.approved) {
      setPin('');
      setError(result.message || 'Ghalat PIN code!');
      pinRef.current?.focus();
      return;
    }
    close(result.approverName || approvers.find(a => a.id === chosen)?.name || 'Manager');
  };

  const selected = approverId || (approvers.length === 1 ? approvers[0].id : '');

  const approvalDialog = pending ? (
    <Modal
      open
      onClose={() => close(null)}
      dismissible={!busy}
      size="sm"
      title={pending.title}
      description={pending.reason}
      initialFocusRef={approvers.length === 1 ? pinRef : undefined}
      icon={<div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100 text-amber-600 dark:bg-amber-950/60 dark:text-amber-400"><ShieldCheck size={20} /></div>}
      footer={<>
        <button type="button" onClick={() => close(null)} disabled={busy} className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700">
          Wapas jayen
        </button>
        <button type="submit" form="manager-approval-form" disabled={busy || approvers.length === 0} className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-slate-800 disabled:opacity-50 dark:bg-lime-500 dark:text-slate-950 dark:hover:bg-lime-400">
          {busy ? 'Check ho raha hai…' : 'Approve karein'}
        </button>
      </>}
    >
      {approvers.length === 0 ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
          Koi manager mojood nahi jo ye approval de sake. Owner Settings → Users & Access mein kisi role ko "Manager Approvals" ki ijazat de.
        </p>
      ) : (
        <form id="manager-approval-form" onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            {approvers.map(user => {
              const active = selected === user.id;
              return (
                <button
                  key={user.id}
                  type="button"
                  onClick={() => { setApproverId(user.id); setError(''); window.setTimeout(() => pinRef.current?.focus(), 0); }}
                  className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm font-bold transition-colors ${active
                    ? 'border-lime-500 bg-lime-50 text-lime-900 dark:border-lime-600 dark:bg-lime-950/40 dark:text-lime-200'
                    : 'border-slate-200 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800'}`}
                >
                  {user.role_id === 'role_super_admin' ? <Crown size={14} className="shrink-0 text-amber-500" /> : <KeyRound size={14} className="shrink-0 text-slate-400" />}
                  <span className="truncate">{user.name}</span>
                </button>
              );
            })}
          </div>
          <input
            ref={pinRef}
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={4}
            aria-label="Manager PIN"
            placeholder="Manager PIN"
            value={pin}
            onChange={event => { setPin(event.target.value.replace(/\D/g, '')); setError(''); }}
            className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-center font-mono text-lg font-black tracking-[0.5em] text-slate-900 outline-none focus:border-lime-500 focus:ring-2 focus:ring-lime-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
          />
          {error && <p role="alert" className="text-sm font-semibold text-rose-600 dark:text-rose-400">{error}</p>}
        </form>
      )}
    </Modal>
  ) : null;

  return { requestApproval, approvalDialog };
}
