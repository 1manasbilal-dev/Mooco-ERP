import React, { useRef, useState } from 'react';
import { Info, Plus } from 'lucide-react';
import { useDairy } from '../../context/DairyContext';
import { useToast } from '../../context/ToastContext';
import { Button, Field, Input, Modal, Select } from '../ui';
import { ACCOUNT_TYPE_ORDER, type AccountType, cashBankKindFor } from './coa';
import { parseAmount } from './ledger';
import { DialogIcon } from './dialogParts';

export interface ParentOption {
  id: string;
  name: string;
  type: AccountType;
  depth: number;
}

interface LedgerAccountDialogProps {
  initialParentId?: string;
  initialType?: AccountType;
  parentOptions: ParentOption[];
  onClose: () => void;
}

/** Add a ledger account (or sub-account) to the Chart of Accounts. Cash / bank names become Bank & Cash accounts. */
export default function LedgerAccountDialog({ initialParentId = '', initialType = 'Liability', parentOptions, onClose }: LedgerAccountDialogProps) {
  const { accounts, manualAccounts, addAccount, addManualAccount } = useDairy();
  const { showToast } = useToast();

  const [parentId, setParentId] = useState(initialParentId);
  const [name, setName] = useState('');
  const [type, setType] = useState<AccountType>(initialType);
  const [opening, setOpening] = useState('');
  const [description, setDescription] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const busyRef = useRef(false);
  const nameRef = useRef<HTMLInputElement>(null);

  const trimmedName = name.trim();
  const cashBankKind = trimmedName ? cashBankKindFor(trimmedName, type, parentId || undefined) : parentId === '1100' ? 'Bank' : null;
  const lowerName = trimmedName.toLowerCase();
  const duplicate = Boolean(trimmedName) && (cashBankKind
    ? accounts.some(a => a.name.trim().toLowerCase() === lowerName)
    : manualAccounts.some(a => a.type === type && a.name.trim().toLowerCase() === lowerName));
  const openingValue = opening.trim() ? parseAmount(opening) : 0;

  const errors = {
    name: !trimmedName ? 'Account ka naam likhein' : duplicate ? 'Is naam ka account pehle se mojood hai' : undefined,
    opening: !Number.isFinite(openingValue) ? 'Sahi raqam likhein' : undefined,
  };
  const hasErrors = Object.values(errors).some(Boolean);
  const show = (message?: string) => (submitted ? message : undefined);

  const changeParent = (id: string) => {
    setParentId(id);
    const parentType = parentOptions.find(p => p.id === id)?.type;
    if (parentType) setType(parentType);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (busyRef.current || hasErrors) return;
    busyRef.current = true;
    setSaving(true);
    try {
      if (cashBankKind) {
        const ok = await addAccount({ name: trimmedName, type: cashBankKind, balance: openingValue, isActive: true });
        if (!ok) return;
        showToast(`Bank / Cash account "${trimmedName}" ban gaya`, 'success');
      } else {
        const ok = await addManualAccount({
          name: trimmedName, type, balance: openingValue, description: description.trim(), parentId, isActive: true,
        });
        if (!ok) {
          showToast('Account nahi ban saka. Dobara koshish karein.', 'error');
          return;
        }
        showToast('Naya ledger account ban gaya', 'success');
      }
      onClose();
    } catch (err: any) {
      showToast('Account nahi ban saka: ' + (err?.message || 'dobara koshish karein'), 'error');
    } finally {
      busyRef.current = false;
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      dismissible={!saving}
      title={parentId ? 'Add sub-account' : 'Add ledger account'}
      description="Chart of Accounts mein naya account, jaise Owner Capital, Bank Loan ya Electricity."
      icon={<DialogIcon tone="brand"><Plus /></DialogIcon>}
      initialFocusRef={nameRef}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="submit" form="ledger-account-form" loading={saving}>Create account</Button>
        </>
      }
    >
      <form id="ledger-account-form" onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        <Field label="Parent account" hint="Khali chorein to top level par banega.">
          {control => (
            <Select {...control} value={parentId} onChange={event => changeParent(event.target.value)}>
              <option value="">(None) Top level account</option>
              {parentOptions.map(opt => (
                <option key={opt.id} value={opt.id}>{`${'  '.repeat(opt.depth)}${opt.depth ? '› ' : ''}${opt.name}`}</option>
              ))}
            </Select>
          )}
        </Field>

        <Field label="Account name" required error={show(errors.name)}>
          {control => (
            <Input {...control} ref={nameRef} placeholder="e.g. Owner Capital, Electricity Bill" value={name} onChange={event => setName(event.target.value)} maxLength={80} />
          )}
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Account type" hint={parentId ? 'Parent ke type par set hai.' : undefined}>
            {control => (
              <Select {...control} value={type} onChange={event => setType(event.target.value as AccountType)} disabled={Boolean(parentId)}>
                {ACCOUNT_TYPE_ORDER.map(t => <option key={t} value={t}>{t}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Opening balance" error={show(errors.opening)}>
            {control => (
              <Input
                {...control}
                type="number"
                inputMode="decimal"
                step="any"
                suffix="Rs"
                placeholder="0"
                value={opening}
                onChange={event => setOpening(event.target.value)}
                className="tabular-nums"
              />
            )}
          </Field>
        </div>

        {cashBankKind ? (
          <p className="flex items-start gap-2 rounded-card border border-info/20 bg-info-soft p-3 text-xs text-info-fg">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>Yeh <strong>Bank & Cash</strong> mein naya <strong>{cashBankKind}</strong> account banega, aur wahan se transfers / deposits ho sakenge.</span>
          </p>
        ) : (
          <Field label="Description">
            {control => (
              <Input {...control} placeholder="Optional notes..." value={description} onChange={event => setDescription(event.target.value)} maxLength={200} />
            )}
          </Field>
        )}
      </form>
    </Modal>
  );
}
