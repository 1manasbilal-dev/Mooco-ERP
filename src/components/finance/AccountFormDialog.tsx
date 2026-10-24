import React, { useRef, useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import { useDairy } from '../../context/DairyContext';
import { useToast } from '../../context/ToastContext';
import type { FinancialAccount } from '../../types';
import { formatCurrency } from '../../lib/formatters';
import { Button, Field, Input, Modal, Money, SegmentedControl } from '../ui';
import { ACCOUNT_ICON, ACCOUNT_TYPES, type AccountKind, parseAmount } from './ledger';
import { DialogIcon, ToggleRow } from './dialogParts';

interface AccountFormDialogProps {
  /** Edit this account; leave empty to add a new one. */
  account?: FinancialAccount | null;
  onClose: () => void;
}

const TYPE_OPTIONS = ACCOUNT_TYPES.map(type => {
  const Icon = ACCOUNT_ICON[type];
  return { value: type, label: type, icon: <Icon /> };
});

/** Add or edit a cash / bank / wallet account. */
export default function AccountFormDialog({ account, onClose }: AccountFormDialogProps) {
  const { accounts, addAccount, updateAccount, getDeleteAssessment } = useDairy();
  const { showToast } = useToast();
  const isEdit = Boolean(account);

  const [name, setName] = useState(account?.name || '');
  const [type, setType] = useState<AccountKind>(account?.type || 'Bank');
  const [bankName, setBankName] = useState(account?.bank_name || '');
  const [accountNumber, setAccountNumber] = useState(account?.account_number || '');
  const [isDrawer, setIsDrawer] = useState(account?.type === 'Cash' && account.isDrawer === true);
  const [isActive, setIsActive] = useState(account ? account.isActive !== false : true);
  const [opening, setOpening] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const busyRef = useRef(false);
  const nameRef = useRef<HTMLInputElement>(null);

  const trimmedName = name.trim();
  const duplicate = trimmedName && accounts.some(a => a.id !== account?.id && a.name.trim().toLowerCase() === trimmedName.toLowerCase());
  const openingValue = opening.trim() ? parseAmount(opening) : 0;

  // Archiving from the edit form follows the same guard as the archive button: no money left, not a default account.
  let statusError: string | undefined;
  if (account && account.isActive !== false && !isActive) {
    const assessment = getDeleteAssessment('account', account.id);
    if (assessment.details?.isSystem) statusError = "The default account can't be made Inactive. Choose another default in Settings first.";
    else if (Number(account.balance || 0) !== 0) statusError = `It holds ${formatCurrency(account.balance)}. Transfer the full amount to another account before making it Inactive.`;
  }

  const errors = {
    name: !trimmedName ? 'Enter an account name' : duplicate ? 'An account with this name already exists' : undefined,
    opening: !Number.isFinite(openingValue) ? 'Enter a valid amount' : undefined,
    status: statusError,
  };
  const hasErrors = Object.values(errors).some(Boolean);
  const show = (message?: string) => (submitted ? message : undefined);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (busyRef.current || hasErrors) return;
    busyRef.current = true;
    setSaving(true);
    try {
      const details: Partial<FinancialAccount> = {
        // Sent as false (not left out) so an account moved off Cash stops being a drawer.
        isDrawer: type === 'Cash' ? isDrawer : false,
      };
      if (type === 'Bank') {
        details.bank_name = bankName.trim();
        details.account_number = accountNumber.trim();
      } else if (account?.type === 'Bank') {
        details.bank_name = '';
        details.account_number = '';
      }
      if (account) {
        const ok = await updateAccount(account.id, { name: trimmedName, type, isActive, ...details });
        if (!ok) {
          showToast("Account couldn't be updated. Please try again.", 'error');
          return;
        }
        showToast(`Account "${trimmedName}" updated`, 'success');
      } else {
        const ok = await addAccount({ name: trimmedName, type, balance: openingValue, isActive: true, ...details });
        if (!ok) return;
        showToast('New account created', 'success');
      }
      onClose();
    } catch (err: any) {
      showToast((isEdit ? "Account couldn't be updated: " : "Account couldn't be created: ") + (err?.message || 'please try again'), 'error');
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
      title={isEdit ? 'Edit account' : 'Add cash / bank account'}
      description={isEdit ? account!.name : 'Cash counter, bank account or mobile wallet (JazzCash, Easypaisa).'}
      icon={<DialogIcon tone="brand">{isEdit ? <Pencil /> : <Plus />}</DialogIcon>}
      initialFocusRef={nameRef}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="submit" form="bank-account-form" loading={saving}>{isEdit ? 'Save changes' : 'Create account'}</Button>
        </>
      }
    >
      <form id="bank-account-form" onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        <Field label="Account name" required error={show(errors.name)}>
          {control => (
            <Input {...control} ref={nameRef} placeholder="e.g. Shop cash counter" value={name} onChange={event => setName(event.target.value)} maxLength={80} />
          )}
        </Field>

        <div>
          <p className="mb-1.5 text-xs font-semibold text-fg-muted">Account type</p>
          <SegmentedControl aria-label="Account type" fullWidth value={type} onChange={setType} options={TYPE_OPTIONS} />
          {isEdit && account!.type !== type && (
            <p className="mt-1.5 text-xs text-warning-fg">Changing the type keeps old entries in this account; only the grouping in reports changes.</p>
          )}
        </div>

        {type === 'Cash' && (
          <ToggleRow
            title="Enable as a cash drawer"
            description="Only enabled Cash accounts become drawers in POS shifts / Cash Control."
            checked={isDrawer}
            onChange={setIsDrawer}
          />
        )}

        {type === 'Bank' && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Bank name">
              {control => <Input {...control} placeholder="e.g. Meezan Bank" value={bankName} onChange={event => setBankName(event.target.value)} maxLength={80} />}
            </Field>
            <Field label="Account number / IBAN">
              {control => <Input {...control} placeholder="e.g. PK36 MEZN ..." value={accountNumber} onChange={event => setAccountNumber(event.target.value)} maxLength={40} />}
            </Field>
          </div>
        )}

        {isEdit ? (
          <>
            <div>
              <ToggleRow
                title="Account active"
                description="Inactive accounts don't show up for new payments and transfers."
                checked={isActive}
                onChange={setIsActive}
              />
              {errors.status && <p className="mt-1.5 text-xs font-semibold text-danger-fg">{errors.status}</p>}
            </div>
            <div className="flex items-center justify-between rounded-card border border-line/70 bg-surface-2 px-3 py-2.5 text-sm">
              <span className="text-fg-subtle">Current balance</span>
              <Money amount={account!.balance} className={account!.balance < 0 ? 'font-bold text-danger-fg' : 'font-bold text-fg'} />
            </div>
          </>
        ) : (
          <Field label="Opening balance" hint="The amount in the account right now. An Opening Balance entry is created for it." error={show(errors.opening)}>
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
        )}
      </form>
    </Modal>
  );
}
