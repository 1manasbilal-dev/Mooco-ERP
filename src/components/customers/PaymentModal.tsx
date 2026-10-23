import React, { useMemo, useRef, useState } from 'react';
import { HandCoins, Info } from 'lucide-react';
import { Button, Field, Input, Modal, SegmentedControl, Select } from '../ui';
import { cn } from '../../lib/cn';
import { formatCurrency, getTodayLocalDate } from '../../lib/formatters';
import { roundCurrency } from '../../lib/db';
import type { Customer, FinancialAccount } from '../../types';
import { CheckRow, KhataBalance } from './CustomerBits';
import { balanceState, parseAmount } from './customerUtils';

export type KhataEntryType = 'Payment' | 'Charge';

export interface KhataEntryInput {
  type: KhataEntryType;
  amount: number;
  date: string;
  mode: string;
  accountId: string;
  note: string;
  sendWhatsApp: boolean;
}

interface PaymentModalProps {
  customer: Customer;
  accounts: FinancialAccount[];
  defaultCashAccountId?: string;
  defaultDigitalAccountId?: string;
  tillAccountIds: string[];
  /** A khata Charge needs customers:edit (the context refuses it otherwise): payment-only users get no toggle. */
  canCharge: boolean;
  defaultAccountForMode: (mode: string) => string;
  sendWhatsApp: boolean;
  onSendWhatsAppChange: (value: boolean) => void;
  onClose: () => void;
  /** Resolves true when posted; the modal stays open on false so nothing typed is lost. */
  onSubmit: (input: KhataEntryInput) => Promise<boolean>;
}

const FORM_ID = 'khata-entry-form';

export default function PaymentModal({
  customer, accounts, defaultCashAccountId, defaultDigitalAccountId, tillAccountIds, canCharge, defaultAccountForMode,
  sendWhatsApp, onSendWhatsAppChange, onClose, onSubmit,
}: PaymentModalProps) {
  const today = getTodayLocalDate();
  const due = balanceState(customer.balance) === 'due';
  const [type, setType] = useState<KhataEntryType>('Payment');
  // Prefill the full due, rounded: a raw float such as 1234.5600000001 used to land in the field.
  const [amount, setAmount] = useState(due ? String(roundCurrency(Number(customer.balance))) : '');
  const [date, setDate] = useState(today);
  const [mode, setMode] = useState('Cash');
  const [accountId, setAccountId] = useState(() => defaultAccountForMode('Cash'));
  const [note, setNote] = useState('');
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const amountRef = useRef<HTMLInputElement>(null);

  const activeAccounts = useMemo(() => accounts.filter(a => a.isActive !== false), [accounts]);
  const parsed = parseAmount(amount);
  const amountError = touched || amount.trim() !== '' ? parsed.error : undefined;
  const dateError = !date ? 'Tareekh chunein' : date > today ? 'Aage ki tareekh par entry nahi ho sakti' : undefined;
  const accountError = type === 'Payment' && !accountId ? 'Account chunein jahan payment jama hogi' : undefined;
  const selectedAccount = activeAccounts.find(a => a.id === accountId);
  const balanceAfter = roundCurrency(Number(customer.balance || 0) + (parsed.error ? 0 : type === 'Payment' ? -parsed.value : parsed.value));
  const canWhatsApp = Boolean(customer.whatsapp || customer.phone);
  const isPayment = type === 'Payment';

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (savingRef.current) return;
    if (parsed.error || dateError || accountError) {
      if (parsed.error) amountRef.current?.focus();
      return;
    }
    savingRef.current = true;
    setSaving(true);
    try {
      await onSubmit({ type, amount: parsed.value, date, mode, accountId, note: note.trim(), sendWhatsApp: canWhatsApp && sendWhatsApp });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="md"
      dismissible={!saving}
      initialFocusRef={amountRef}
      icon={<span className={cn('flex size-10 items-center justify-center rounded-xl', isPayment ? 'bg-success-soft text-success-fg' : 'bg-danger-soft text-danger-fg')}><HandCoins size={20} /></span>}
      title="Khata entry"
      description={<span className="flex flex-wrap items-center gap-x-2">{customer.name} · <KhataBalance balance={customer.balance} /></span>}
      footer={<>
        <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button type="submit" form={FORM_ID} variant={isPayment ? 'primary' : 'danger'} loading={saving}>
          {isPayment ? 'Save payment (deposit)' : 'Save khata charge'}
        </Button>
      </>}
    >
      <form id={FORM_ID} onSubmit={handleSubmit} className="space-y-4" noValidate>
        {canCharge && (
          <SegmentedControl<KhataEntryType>
            aria-label="Entry type"
            fullWidth
            value={type}
            onChange={setType}
            options={[
              { value: 'Payment', label: 'Payment (received)' },
              { value: 'Charge', label: 'Charge (debit khata)' },
            ]}
          />
        )}

        <Field label="Amount" required error={amountError}>
          {control => (
            <Input
              {...control}
              ref={amountRef}
              inputMode="decimal"
              inputSize="lg"
              autoComplete="off"
              className="font-bold tabular-nums"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder="0"
              suffix="Rs"
            />
          )}
        </Field>
        {isPayment && due && (
          <div className="-mt-2 flex flex-wrap gap-1.5">
            <Button variant="soft" size="sm" onClick={() => setAmount(String(roundCurrency(Number(customer.balance))))}>
              Poora baqaya {formatCurrency(customer.balance)}
            </Button>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Date" error={dateError}>
            {control => <Input {...control} type="date" max={today} value={date} onChange={e => setDate(e.target.value)} />}
          </Field>
          <Field label="Payment mode">
            {control => (
              <Select
                {...control}
                value={mode}
                onChange={e => {
                  setMode(e.target.value);
                  setAccountId(defaultAccountForMode(e.target.value));
                }}
              >
                <option value="Cash">Cash</option>
                <option value="Online">Online transfer</option>
                <option value="Cheque">Cheque</option>
              </Select>
            )}
          </Field>
        </div>

        {isPayment ? (
          <Field
            label="Deposit to account"
            required
            error={touched ? accountError : undefined}
            hint={selectedAccount ? `${selectedAccount.name} (${selectedAccount.type}) · current balance ${formatCurrency(Number(selectedAccount.balance || 0))}` : 'Account chunein jahan payment jama hogi.'}
          >
            {control => (
              <Select {...control} value={accountId} onChange={e => setAccountId(e.target.value)}>
                <option value="">-- Account chunein --</option>
                {activeAccounts.map(acc => (
                  <option key={acc.id} value={acc.id}>
                    {acc.name} ({acc.type}) - Bal: {formatCurrency(Number(acc.balance || 0))}
                    {tillAccountIds.includes(acc.id) ? ' [Active Till]' : ''}
                    {acc.id === defaultCashAccountId ? ' ★ Default Cash' : ''}
                    {acc.id === defaultDigitalAccountId ? ' ★ Default Digital' : ''}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ) : (
          <div className="flex gap-2.5 rounded-control border border-danger/25 bg-danger-soft p-3 text-xs text-danger-fg">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <p>
              <span className="block font-bold">Khata charge (customer udhaar)</span>
              Ye raqam customer ke khaate mein izafa karegi (customer ke zimme udhaar barh jayega). Cash ya bank account par koi asar nahi parega.
            </p>
          </div>
        )}

        <Field label="Notes / description">
          {control => (
            <Input
              {...control}
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder={isPayment ? 'e.g. Paid in full via cash' : 'e.g. Delivery charges / extra milk supply'}
            />
          )}
        </Field>

        <div className="flex items-center justify-between gap-3 rounded-control bg-surface-2 px-3 py-2.5 text-[13px]">
          <span className="font-semibold text-fg-muted">Entry ke baad balance</span>
          <KhataBalance balance={balanceAfter} />
        </div>

        {canWhatsApp && (
          <CheckRow id="khata-entry-whatsapp" checked={sendWhatsApp} onChange={onSendWhatsAppChange} label="Customer ko WhatsApp receipt bhejein" />
        )}
      </form>
    </Modal>
  );
}
