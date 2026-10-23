import React, { useMemo, useRef, useState } from 'react';
import { AlertTriangle, Banknote } from 'lucide-react';
import { useDairy } from '../../context/DairyContext';
import { Supplier } from '../../types';
import { cleanNumber, formatCurrency, getTodayLocalDate } from '../../lib/formatters';
import { Button, Field, Input, Modal, Money, Select } from '../ui';
import { cn } from '../../lib/cn';
import { SupplierBalance, balanceLabel, balanceState } from './supplierUi';

const MODES = [
  { value: 'Cash', label: 'Cash' },
  { value: 'Bank Transfer', label: 'Bank Transfer' },
  { value: 'Online', label: 'Online / Wallet' },
];

type Errors = Partial<Record<'amount' | 'date' | 'account', string>>;

/** Record a payment to a supplier: the khata payable goes down and the chosen account pays it. */
export function SupplierPaymentModal({ supplier, onClose }: { supplier: Supplier; onClose: () => void }) {
  const { accounts = [], settings, activeShiftSession, recordSupplierPayment, isDayLocked } = useDairy();
  const today = getTodayLocalDate();
  const balance = Number(supplier.pending_balance) || 0;
  const activeAccounts = useMemo(() => (accounts || []).filter(a => a.isActive !== false), [accounts]);

  const defaultAccount = (mode: string) => {
    const isCash = !mode || mode.toLowerCase().includes('cash');
    if (isCash) {
      return (
        activeShiftSession?.account_id ||
        activeShiftSession?.drawer_id ||
        settings?.financial?.defaultCashAccountId ||
        activeAccounts.find(a => a.type === 'Cash')?.id ||
        activeAccounts[0]?.id ||
        ''
      );
    }
    return (
      settings?.financial?.defaultDigitalAccountId ||
      activeAccounts.find(a => a.type === 'Bank' || a.type === 'Wallet')?.id ||
      activeAccounts[0]?.id ||
      ''
    );
  };

  const [amount, setAmount] = useState(() => (balance > 0 ? String(cleanNumber(balance)) : ''));
  const [date, setDate] = useState(today);
  const [mode, setMode] = useState('Cash');
  const [accountId, setAccountId] = useState(() => defaultAccount('Cash'));
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const amountRef = useRef<HTMLInputElement>(null);

  const amountNum = cleanNumber(amount);
  const account = activeAccounts.find(a => a.id === accountId);
  const accountBalance = Number(account?.balance || 0);
  const after = cleanNumber(balance - (amountNum > 0 ? amountNum : 0));
  const overpay = balance > 0 && amountNum > balance + 0.5;
  const shortOfFunds = Boolean(account) && amountNum > 0 && amountNum > accountBalance + 0.5;

  const validate = (): Errors => {
    const next: Errors = {};
    const raw = Number(amount);
    if (!amount.trim() || !Number.isFinite(raw)) next.amount = 'Amount likhein';
    else if (raw <= 0 || amountNum <= 0) next.amount = 'Amount 0 se zyada honi chahiye';
    if (!date) next.date = 'Tareekh chunein';
    else if (date > today) next.date = 'Aage ki tareekh par payment nahi ho sakti';
    else if (isDayLocked?.(date)) next.date = 'Ye din band (locked) hai. Aaj ki tareekh chunein.';
    if (activeAccounts.length > 0 && !accountId) next.account = 'Payment kis account se hui? Account chunein';
    return next;
  };

  const handleSubmit = async (event?: React.FormEvent) => {
    event?.preventDefault();
    if (savingRef.current || activeAccounts.length === 0) return;
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length > 0) {
      if (found.amount) amountRef.current?.focus();
      return;
    }

    savingRef.current = true;
    setSaving(true);
    try {
      // DairyContext shows the success / failure toast itself.
      const ok = await recordSupplierPayment(supplier.id, amountNum, date, mode, 'Payment', note.trim(), accountId || undefined);
      if (ok) onClose();
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const clearError = (key: keyof Errors) => setErrors(prev => (prev[key] ? { ...prev, [key]: undefined } : prev));

  return (
    <Modal
      open
      onClose={onClose}
      dismissible={!saving}
      initialFocusRef={amountRef}
      icon={<span className="flex size-10 items-center justify-center rounded-xl bg-success-soft text-success-fg"><Banknote className="size-5" /></span>}
      title="Supplier ko payment"
      description={supplier.name}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="submit" form="supplier-payment-form" loading={saving} disabled={activeAccounts.length === 0}>
            {saving ? 'Saving...' : amountNum > 0 ? `Pay ${formatCurrency(amountNum)}` : 'Confirm payment'}
          </Button>
        </>
      }
    >
      <form id="supplier-payment-form" onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3 rounded-control border border-line bg-surface-2 px-3.5 py-3">
          <div>
            <p className="text-xs font-semibold text-fg-subtle">Abhi ka khata</p>
            <p className="text-[11px] text-fg-faint">{balanceLabel(balance, true)}</p>
          </div>
          <SupplierBalance value={balance} label="none" className="text-lg font-bold" />
        </div>

        <Field label="Amount" required error={errors.amount}>
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
              className="font-bold tabular-nums"
              value={amount}
              onChange={e => { setAmount(e.target.value); clearError('amount'); }}
            />
          )}
        </Field>
        {balance > 0.5 && Math.abs(amountNum - balance) > 0.5 && (
          <div className="-mt-2 flex flex-wrap gap-1.5">
            <Button variant="soft" size="sm" onClick={() => { setAmount(String(cleanNumber(balance))); clearError('amount'); }}>
              Pura payable <Money amount={balance} />
            </Button>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Mode">
            {control => (
              <Select
                {...control}
                value={mode}
                onChange={e => {
                  const next = e.target.value;
                  setMode(next);
                  setAccountId(defaultAccount(next));
                  clearError('account');
                }}
              >
                {MODES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Tareekh" required error={errors.date}>
            {control => (
              <Input {...control} type="date" max={today} value={date} onChange={e => { setDate(e.target.value); clearError('date'); }} />
            )}
          </Field>
        </div>

        {activeAccounts.length === 0 ? (
          <p role="alert" className="flex items-start gap-2 rounded-control bg-warning-soft px-3 py-2.5 text-xs font-medium text-warning-fg">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            Koi Cash drawer ya Bank account nahi hai. Pehle Bank &amp; Cash mein account banayein.
          </p>
        ) : (
          <Field
            label="Kis account se diya"
            required
            error={errors.account}
            hint={account ? <>Account mein abhi <Money amount={accountBalance} className="font-semibold text-fg-muted" /></> : undefined}
          >
            {control => (
              <Select {...control} value={accountId} onChange={e => { setAccountId(e.target.value); clearError('account'); }}>
                <option value="">Account chunein</option>
                {activeAccounts.map(a => {
                  const tags = [
                    activeShiftSession && (a.id === activeShiftSession.drawer_id || a.id === activeShiftSession.account_id) ? 'Active till' : '',
                    a.id === settings?.financial?.defaultCashAccountId ? 'Default cash' : '',
                    a.id === settings?.financial?.defaultDigitalAccountId ? 'Default digital' : '',
                  ].filter(Boolean);
                  return (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.type}) · {formatCurrency(Number(a.balance || 0))}{tags.length ? ` · ${tags.join(', ')}` : ''}
                    </option>
                  );
                })}
              </Select>
            )}
          </Field>
        )}

        <Field label="Note / reference" hint="Optional, e.g. cheque #, milk bill 1-10">
          {control => <Input {...control} value={note} maxLength={200} placeholder="e.g. Milk payment" onChange={e => setNote(e.target.value)} />}
        </Field>

        {amountNum > 0 && (
          <div className={cn('rounded-control px-3.5 py-2.5 text-xs', overpay ? 'bg-info-soft text-info-fg' : 'bg-surface-2 text-fg-muted')}>
            <p className="flex items-center justify-between gap-2 font-semibold">
              <span>Payment ke baad khata</span>
              <SupplierBalance value={after} />
            </p>
            {overpay && <p className="mt-1">Payable se zyada payment: <Money amount={Math.abs(after)} /> advance ban jayega.</p>}
            {balanceState(balance) !== 'payable' && <p className="mt-1">Is supplier ka koi payable nahi; ye poori payment advance hogi.</p>}
          </div>
        )}
        {shortOfFunds && (
          <p className="flex items-start gap-2 rounded-control bg-warning-soft px-3 py-2 text-xs font-medium text-warning-fg">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {account?.name} mein sirf {formatCurrency(accountBalance)} hai. Check kar lein ke paisa isi account se gaya.
          </p>
        )}
      </form>
    </Modal>
  );
}

export default SupplierPaymentModal;
