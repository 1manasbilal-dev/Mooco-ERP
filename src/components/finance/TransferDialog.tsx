import React, { useMemo, useRef, useState } from 'react';
import { ArrowRightLeft, ArrowUpDown } from 'lucide-react';
import { useDairy } from '../../context/DairyContext';
import { useToast } from '../../context/ToastContext';
import { formatCurrency } from '../../lib/formatters';
import { Button, Field, IconButton, Input, Modal, Money, Select, confirmAction } from '../ui';
import { canOverdraw, parseAmount, todayPk } from './ledger';
import { DialogIcon, accountOptionLabel } from './dialogParts';

interface TransferDialogProps {
  onClose: () => void;
  /** Pre-selects the source account (the account whose statement is open). */
  defaultFromId?: string;
}

/** Move money between two of our own accounts (e.g. cash counter to bank). */
export default function TransferDialog({ onClose, defaultFromId }: TransferDialogProps) {
  const { accounts, transferFunds, isPeriodLocked, settings } = useDairy();
  const { showToast } = useToast();
  // Inactive accounts are hidden from selectors.
  const activeAccounts = useMemo(() => accounts.filter(a => a.isActive !== false), [accounts]);

  const [fromId, setFromId] = useState(() => (defaultFromId && activeAccounts.some(a => a.id === defaultFromId) ? defaultFromId : ''));
  const [toId, setToId] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayPk);
  const [note, setNote] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const busyRef = useRef(false);
  const amountRef = useRef<HTMLInputElement>(null);
  const fromRef = useRef<HTMLSelectElement>(null);

  const from = activeAccounts.find(a => a.id === fromId);
  const to = activeAccounts.find(a => a.id === toId);
  const value = parseAmount(amount);
  const validAmount = Number.isFinite(value) && value > 0;

  const errors = {
    from: !from ? 'Choose the account to send from' : undefined,
    to: !to ? 'Choose the account to send to' : to.id === fromId ? 'The two accounts must be different' : undefined,
    amount: !validAmount
      ? 'Enter an amount above 0'
      : from && !canOverdraw(from) && value > from.balance
        ? `${from.name} has only ${formatCurrency(from.balance)}. A ${from.type} account can't go into minus.`
        : undefined,
    date: !date ? 'Choose a date' : isPeriodLocked(date) ? `Books are closed up to ${settings.security?.lockDate}. Choose a later date.` : undefined,
  };
  const hasErrors = Object.values(errors).some(Boolean);
  const show = (message?: string) => (submitted ? message : undefined);

  const swap = () => {
    setFromId(toId);
    setToId(fromId);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (busyRef.current || hasErrors || !from || !to) return;
    busyRef.current = true;
    try {
      if (value > from.balance) {
        // Only bank accounts get here: they can be overdrawn, after a clear warning.
        const confirmed = await confirmAction({
          tone: 'warning',
          title: 'Not enough balance in the account',
          message: `"${from.name}" has ${formatCurrency(from.balance)}, and the transfer is ${formatCurrency(value)}.`,
          consequences: [
            `After the transfer, the balance of "${from.name}" will be ${formatCurrency(from.balance - value)} (minus).`,
            'You will need to match this difference with the bank statement later.',
          ],
          confirmLabel: 'Transfer anyway',
        });
        if (!confirmed) return;
      }
      setSaving(true);
      const ok = await transferFunds(from.id, to.id, value, date, note.trim());
      if (!ok) return;
      showToast('Amount transferred', 'success');
      onClose();
    } catch (err: any) {
      showToast("Transfer couldn't be made: " + (err?.message || 'please try again'), 'error');
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
      title="Transfer between accounts"
      description="Move an amount from one account to another, e.g. from the cash counter to the bank."
      icon={<DialogIcon tone="info"><ArrowRightLeft /></DialogIcon>}
      initialFocusRef={from ? amountRef : fromRef}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="submit" form="bank-transfer-form" loading={saving} leftIcon={<ArrowRightLeft />}>Transfer</Button>
        </>
      }
    >
      <form id="bank-transfer-form" onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        <div className="flex flex-col gap-1 rounded-card border border-line/70 bg-surface-2 p-3">
          <Field label="From (source)" required error={show(errors.from)}>
            {control => (
              <Select {...control} ref={fromRef} value={fromId} onChange={event => setFromId(event.target.value)}>
                <option value="">Choose account...</option>
                {activeAccounts.map(a => <option key={a.id} value={a.id}>{accountOptionLabel(a)}</option>)}
              </Select>
            )}
          </Field>
          <div className="flex justify-center">
            <IconButton aria-label="Swap From and To" icon={<ArrowUpDown />} size="sm" variant="secondary" onClick={swap} />
          </div>
          <Field label="To (destination)" required error={show(errors.to)}>
            {control => (
              <Select {...control} value={toId} onChange={event => setToId(event.target.value)}>
                <option value="">Choose account...</option>
                {activeAccounts.filter(a => a.id !== fromId).map(a => <option key={a.id} value={a.id}>{accountOptionLabel(a)}</option>)}
              </Select>
            )}
          </Field>
        </div>

        <Field
          label="Amount"
          required
          error={show(errors.amount)}
          hint={from ? <>Available: <Money amount={from.balance} className="font-semibold text-fg-muted" /></> : undefined}
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
        {from && from.balance > 0 && (
          <div className="-mt-2">
            <Button variant="ghost" size="sm" onClick={() => setAmount(String(from.balance))}>
              Full balance: <Money amount={from.balance} />
            </Button>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Date" required error={show(errors.date)}>
            {control => <Input {...control} type="date" value={date} onChange={event => setDate(event.target.value)} />}
          </Field>
          <Field label="Note">
            {control => (
              <Input {...control} placeholder="e.g. Cash deposit to bank" value={note} onChange={event => setNote(event.target.value)} maxLength={200} />
            )}
          </Field>
        </div>

        {from && to && validAmount && !errors.to && (
          <dl className="grid grid-cols-2 gap-3 rounded-card border border-line/70 bg-surface-2 p-3 text-xs">
            <div className="min-w-0">
              <dt className="truncate text-fg-subtle">{from.name} after</dt>
              <dd className={from.balance - value < 0 ? 'font-bold text-danger-fg' : 'font-bold text-fg'}><Money amount={from.balance - value} /></dd>
            </div>
            <div className="min-w-0">
              <dt className="truncate text-fg-subtle">{to.name} after</dt>
              <dd className="font-bold text-fg"><Money amount={to.balance + value} /></dd>
            </div>
          </dl>
        )}
      </form>
    </Modal>
  );
}
