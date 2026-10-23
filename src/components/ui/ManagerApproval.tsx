import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Crown, KeyRound, ShieldCheck } from 'lucide-react';
import { Modal } from './Modal';
import { Button } from './Button';
import { controlClass } from './Field';
import { cn } from '../../lib/cn';
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
      icon={<div className="flex size-10 items-center justify-center rounded-xl bg-warning-soft text-warning-fg ring-1 ring-inset ring-warning/25"><ShieldCheck size={20} /></div>}
      footer={<>
        <Button variant="secondary" onClick={() => close(null)} disabled={busy}>
          Wapas jayen
        </Button>
        <Button type="submit" form="manager-approval-form" loading={busy} disabled={approvers.length === 0}>
          {busy ? 'Check ho raha hai…' : 'Approve karein'}
        </Button>
      </>}
    >
      {approvers.length === 0 ? (
        <p className="rounded-control bg-warning-soft p-3 text-sm text-warning-fg ring-1 ring-inset ring-warning/25">
          Koi manager mojood nahi jo ye approval de sake. Owner Settings → Users & Access mein kisi role ko "Manager Approvals" ki ijazat de.
        </p>
      ) : (
        <form id="manager-approval-form" onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-2 gap-2" role="group" aria-label="Manager">
            {approvers.map(user => {
              const active = selected === user.id;
              return (
                <button
                  key={user.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => { setApproverId(user.id); setError(''); window.setTimeout(() => pinRef.current?.focus(), 0); }}
                  className={cn(
                    'flex h-11 cursor-pointer items-center gap-2 rounded-control px-3 text-left text-sm font-semibold ring-1 ring-inset transition-colors duration-150',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    active ? 'bg-brand-soft text-brand-fg ring-brand-accent' : 'bg-surface text-fg-muted ring-line hover:bg-surface-2 hover:text-fg',
                  )}
                >
                  {user.role_id === 'role_super_admin' ? <Crown size={14} className="shrink-0 text-warning" /> : <KeyRound size={14} className="shrink-0 text-fg-faint" />}
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
            aria-invalid={error ? true : undefined}
            placeholder="Manager PIN"
            value={pin}
            onChange={event => { setPin(event.target.value.replace(/\D/g, '')); setError(''); }}
            className={cn(controlClass, 'h-12 px-4 text-center font-mono text-lg font-bold tracking-[0.5em] placeholder:tracking-normal')}
          />
          {error && <p role="alert" className="text-sm font-semibold text-danger-fg">{error}</p>}
        </form>
      )}
    </Modal>
  ) : null;

  return { requestApproval, approvalDialog };
}
