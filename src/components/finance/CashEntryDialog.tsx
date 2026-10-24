import React, { useMemo, useRef, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, Info } from 'lucide-react';
import { useDairy } from '../../context/DairyContext';
import { useToast } from '../../context/ToastContext';
import type { ManualAccount } from '../../types';
import { formatCurrency } from '../../lib/formatters';
import { Button, Field, Input, Modal, Money, SegmentedControl, Select, confirmAction } from '../ui';
import { canOverdraw, parseAmount, todayPk } from './ledger';
import { DialogIcon, accountOptionLabel } from './dialogParts';

export type CashEntryMode = 'Deposit' | 'Withdrawal';

interface ContraOption {
  id: string;
  label: string;
  hint: string;
}

interface ContraGroup {
  groupLabel: string;
  accounts: ContraOption[];
}

const option = (account: ManualAccount, suffix: string, hint: string): ContraOption => ({ id: account.id, label: `${account.name} (${suffix})`, hint });

/** Ledger accounts that can sit on the other side of a deposit / withdrawal, grouped for the picker. */
function contraGroupsFor(mode: CashEntryMode, manualAccounts: ManualAccount[]): ContraGroup[] {
  const activeManual = manualAccounts.filter(acc => acc.isActive !== false);
  const loanAccounts = activeManual.filter(acc => acc.type === 'Liability');
  const groups: ContraGroup[] = [];

  if (mode === 'Deposit') {
    const capitalAccounts = activeManual.filter(acc =>
      acc.type === 'Equity' && !acc.name.toLowerCase().includes('drawing') && acc.parentId !== 'sys_eq_draw_group');
    const incomeAccounts = activeManual.filter(acc => acc.type === 'Income');
    if (capitalAccounts.length > 0) groups.push({
      groupLabel: "Owner's Equity & Capital",
      accounts: capitalAccounts.map(a => option(a, 'Equity', "Invested by owner into the business. Increases Owner's Capital in Balance Sheet.")),
    });
    if (loanAccounts.length > 0) groups.push({
      groupLabel: 'Loans & Borrowings (Liabilities)',
      accounts: loanAccounts.map(a => option(a, 'Liability', 'Loan/borrowed funds received from bank or partner. Updates liability obligations.')),
    });
    if (incomeAccounts.length > 0) groups.push({
      groupLabel: 'Direct & Miscellaneous Income',
      accounts: incomeAccounts.map(a => option(a, 'Income', 'Incidental receipts or scrap revenue not from core retail billing.')),
    });
    return groups;
  }

  const drawingAccounts = activeManual.filter(acc =>
    acc.type === 'Equity' &&
    (acc.name.toLowerCase().includes('drawing') || acc.parentId === 'sys_eq_draw_group' || !acc.name.toLowerCase().includes('capital')));
  const assetAccounts = activeManual.filter(acc => acc.type === 'Asset');
  if (drawingAccounts.length > 0) groups.push({
    groupLabel: "Owner's Equity & Personal Drawings",
    accounts: drawingAccounts.map(a => option(a, 'Equity', "Withdrawn by owner for personal expenses. Deducts from Owner's Equity in Balance Sheet.")),
  });
  if (loanAccounts.length > 0) groups.push({
    groupLabel: 'Loan Repayments (Liabilities)',
    accounts: loanAccounts.map(a => option(a, 'Liability Repayment', 'Repaying principal loan borrowed. Reduces liability balance.')),
  });
  if (assetAccounts.length > 0) groups.push({
    groupLabel: 'Fixed Assets & Equipment (CapEx)',
    accounts: assetAccounts.map(a => option(a, 'Asset Purchase', 'Capital expenditure purchasing machinery, furniture, or equipment.')),
  });
  return groups;
}

/** Default contra account: Owner Capital for a deposit, Owner Drawings for a withdrawal. */
function defaultContraId(mode: CashEntryMode, manualAccounts: ManualAccount[]) {
  const match = manualAccounts.find(a =>
    a.isActive !== false && a.type === 'Equity' &&
    (mode === 'Deposit'
      ? a.id === 'ma_owner_capital' || a.name.toLowerCase().includes('capital')
      : a.id === 'ma_owner_drawings' || a.name.toLowerCase().includes('drawing')));
  return match?.id || '';
}

interface CashEntryDialogProps {
  mode: CashEntryMode;
  onClose: () => void;
  defaultAccountId?: string;
}

/** Record money put into (deposit) or taken out of (withdrawal) an account, with its contra ledger. */
export default function CashEntryDialog({ mode: initialMode, onClose, defaultAccountId }: CashEntryDialogProps) {
  const { accounts, manualAccounts, recordBankTransaction, isPeriodLocked, settings } = useDairy();
  const { showToast } = useToast();
  const activeAccounts = useMemo(() => accounts.filter(a => a.isActive !== false), [accounts]);

  const [mode, setMode] = useState<CashEntryMode>(initialMode);
  const [accountId, setAccountId] = useState(() =>
    defaultAccountId && activeAccounts.some(a => a.id === defaultAccountId) ? defaultAccountId : activeAccounts[0]?.id || '');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayPk);
  const [relatedAccountId, setRelatedAccountId] = useState(() => defaultContraId(initialMode, manualAccounts));
  const [description, setDescription] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const busyRef = useRef(false);
  const amountRef = useRef<HTMLInputElement>(null);

  const contraGroups = useMemo(() => contraGroupsFor(mode, manualAccounts), [mode, manualAccounts]);
  const selectedContra = useMemo(() => {
    if (!relatedAccountId) return null;
    for (const group of contraGroups) {
      const match = group.accounts.find(a => a.id === relatedAccountId);
      if (match) return match;
    }
    const direct = manualAccounts.find(a => a.id === relatedAccountId);
    return direct ? { id: direct.id, label: `${direct.name} (${direct.type})`, hint: `Account classified under ${direct.type}` } : null;
  }, [contraGroups, relatedAccountId, manualAccounts]);

  const changeMode = (next: CashEntryMode) => {
    setMode(next);
    setRelatedAccountId(defaultContraId(next, manualAccounts));
  };

  const isDeposit = mode === 'Deposit';
  const account = activeAccounts.find(a => a.id === accountId);
  const value = parseAmount(amount);
  const validAmount = Number.isFinite(value) && value > 0;
  const errors = {
    account: !account ? 'Choose an account' : undefined,
    amount: !validAmount
      ? 'Enter an amount above 0'
      : !isDeposit && account && !canOverdraw(account) && value > account.balance
        ? `${account.name} has only ${formatCurrency(account.balance)}. A ${account.type} account can't go into minus.`
        : undefined,
    date: !date ? 'Choose a date' : isPeriodLocked(date) ? `Books are closed up to ${settings.security?.lockDate}. Choose a later date.` : undefined,
  };
  const hasErrors = Object.values(errors).some(Boolean);
  const show = (message?: string) => (submitted ? message : undefined);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (busyRef.current || hasErrors || !account) return;
    busyRef.current = true;
    try {
      if (!isDeposit && value > account.balance) {
        const confirmed = await confirmAction({
          tone: 'warning',
          title: 'Not enough balance in the account',
          message: `"${account.name}" has ${formatCurrency(account.balance)}, and the withdrawal is ${formatCurrency(value)}.`,
          consequences: [`After this, the balance of "${account.name}" will be ${formatCurrency(account.balance - value)} (minus).`],
          confirmLabel: 'Withdraw anyway',
        });
        if (!confirmed) return;
      }

      // Double entry: the server posts the bank side and the contra account together, each as a
      // delta on its locked row (writing "screen balance + change" lost postings made elsewhere).
      const contra = relatedAccountId ? manualAccounts.find(a => a.id === relatedAccountId) : undefined;

      setSaving(true);
      const ok = await recordBankTransaction({
        account_id: account.id,
        amount: value,
        date,
        description: description.trim() || (isDeposit ? 'Received' : 'Paid'),
        type: mode,
        category: contra ? contra.name : mode,
        related_account_id: contra ? contra.id : null,
      });
      // recordBankTransaction already said why it failed; nothing was posted.
      if (!ok) return;
      showToast(`${mode} recorded`, 'success');
      onClose();
    } catch (err: any) {
      showToast("Transaction couldn't be recorded: " + (err?.message || 'please try again'), 'error');
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
      title={isDeposit ? 'Record deposit' : 'Record withdrawal'}
      description={isDeposit ? 'Money coming into the account (money in).' : 'Money going out of the account (money out).'}
      icon={<DialogIcon tone={isDeposit ? 'success' : 'danger'}>{isDeposit ? <ArrowDownLeft /> : <ArrowUpRight />}</DialogIcon>}
      initialFocusRef={amountRef}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="submit" form="bank-cash-entry-form" loading={saving}>
            {isDeposit ? 'Save deposit' : 'Save withdrawal'}
          </Button>
        </>
      }
    >
      <form id="bank-cash-entry-form" onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        <SegmentedControl
          aria-label="Entry type"
          fullWidth
          value={mode}
          onChange={changeMode}
          options={[
            { value: 'Deposit', label: 'Deposit (in)', icon: <ArrowDownLeft /> },
            { value: 'Withdrawal', label: 'Withdraw (out)', icon: <ArrowUpRight /> },
          ]}
        />

        <Field label={isDeposit ? 'Deposit into' : 'Withdraw from'} required error={show(errors.account)}>
          {control => (
            <Select {...control} value={accountId} onChange={event => setAccountId(event.target.value)}>
              <option value="">Choose account...</option>
              {activeAccounts.map(a => <option key={a.id} value={a.id}>{accountOptionLabel(a)}</option>)}
            </Select>
          )}
        </Field>

        <Field
          label="Amount"
          required
          error={show(errors.amount)}
          hint={account && !isDeposit ? <>Available: <Money amount={account.balance} className="font-semibold text-fg-muted" /></> : undefined}
        >
          {control => (
            <Input
              {...control}
              ref={amountRef}
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              inputSize="lg"
              suffix="Rs"
              placeholder="0"
              value={amount}
              onChange={event => setAmount(event.target.value)}
              className="font-bold tabular-nums"
            />
          )}
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Date" required error={show(errors.date)}>
            {control => <Input {...control} type="date" value={date} onChange={event => setDate(event.target.value)} />}
          </Field>
          <Field label={isDeposit ? 'Received from' : 'Paid to / for'}>
            {control => (
              <Select {...control} value={relatedAccountId} onChange={event => setRelatedAccountId(event.target.value)}>
                {contraGroups.map(group => (
                  <optgroup key={group.groupLabel} label={group.groupLabel}>
                    {group.accounts.map(acc => <option key={acc.id} value={acc.id}>{acc.label}</option>)}
                  </optgroup>
                ))}
                <optgroup label="Direct / Other">
                  <option value="">Direct entry (no contra ledger)</option>
                </optgroup>
              </Select>
            )}
          </Field>
        </div>

        {selectedContra && (
          <div className="flex items-start gap-2 rounded-card border border-line/70 bg-surface-2 p-3 text-xs">
            <Info className="mt-0.5 size-4 shrink-0 text-info-fg" aria-hidden="true" />
            <p className="leading-snug">
              <span className="block font-semibold text-fg">{selectedContra.label}</span>
              <span className="text-fg-subtle">{selectedContra.hint}</span>
            </p>
          </div>
        )}

        <Field label="Description">
          {control => (
            <Input {...control} placeholder="Short detail..." value={description} onChange={event => setDescription(event.target.value)} maxLength={200} />
          )}
        </Field>
      </form>
    </Modal>
  );
}
