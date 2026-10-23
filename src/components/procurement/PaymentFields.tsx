import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Banknote, Smartphone, Wallet } from 'lucide-react';
import { useDairy } from '../../context/DairyContext';
import { cn } from '../../lib/cn';
import { formatCurrency } from '../../lib/formatters';
import { Badge, controlClass, Select } from '../ui';
import { SmartNumberInput } from '../SmartNumberInput';
import { PillGroup, PillOption } from './ProcurementUI';

/** Paid-now amount, payment mode and paying account, shared by the milk slip and the supplies bill. */

export const PAY_MODES: PillOption<string>[] = [
  { value: 'Cash', label: 'Cash', icon: <Banknote size={13} aria-hidden="true" /> },
  { value: 'Online', label: 'Online', icon: <Smartphone size={13} aria-hidden="true" /> },
];

/** Active accounts plus the account a payment in `mode` should come from (the open drawer first for cash). */
export function usePaymentAccount(mode: string) {
  const { accounts = [], settings, activeShiftSession } = useDairy();
  const availableAccounts = useMemo(() => (accounts || []).filter((a: any) => a.isActive !== false), [accounts]);
  const [accountId, setAccountId] = useState('');
  const defaultCash = settings?.financial?.defaultCashAccountId;
  const defaultDigital = settings?.financial?.defaultDigitalAccountId;
  const activeDrawerId = activeShiftSession?.drawer_id || activeShiftSession?.account_id;

  // Re-pick when the mode or the defaults change. A balance refresh after each save gives a new
  // accounts array; that alone keeps the account the user chose.
  const pickKey = `${mode}|${activeDrawerId || ''}|${defaultCash || ''}|${defaultDigital || ''}`;
  const lastKeyRef = useRef('');
  useEffect(() => {
    const keyChanged = lastKeyRef.current !== pickKey;
    lastKeyRef.current = pickKey;
    if (availableAccounts.length === 0) { setAccountId(''); return; }
    const byId = (id?: string) => (id ? availableAccounts.find((a: any) => a.id === id) : undefined);
    setAccountId(prev => {
      if (!keyChanged && byId(prev)) return prev;
      const found = mode === 'Cash'
        ? byId(activeDrawerId) || byId(defaultCash) || availableAccounts.find((a: any) => a.type === 'Cash') || availableAccounts[0]
        : byId(defaultDigital) || availableAccounts.find((a: any) => a.type === 'Bank' || a.type === 'Wallet') || availableAccounts[0];
      return found ? found.id : '';
    });
  }, [pickKey, mode, availableAccounts, defaultCash, defaultDigital, activeDrawerId]);

  return { availableAccounts, accountId, setAccountId, hasShiftDrawer: Boolean(activeShiftSession) };
}

const chipClass = (active: boolean) => cn(
  'h-7 cursor-pointer rounded-lg px-2 text-[11px] font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-40',
  active ? 'bg-brand text-brand-on' : 'bg-surface text-fg-muted ring-1 ring-inset ring-line hover:text-fg',
);

/** "Rs ___  [Khata] [Full]" — blank means nothing paid, Full copies the bill total. */
export function PaidInput({
  value, onChange, total, paid, id, onKeyDown, invalid, describedBy,
}: {
  value: string;
  onChange: (value: string) => void;
  total: number;
  paid: number;
  id?: string;
  onKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  invalid?: boolean;
  describedBy?: string;
}) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-xs font-semibold text-fg-subtle">Rs</span>
      <SmartNumberInput
        id={id}
        step="any"
        min="0"
        inputMode="decimal"
        placeholder="0 (khata)"
        aria-label={id ? undefined : 'Paid now'}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        className={cn(controlClass, 'h-11 pl-9 pr-[7.5rem] text-base font-bold tabular-nums')}
        value={value}
        onChange={onChange}
        onKeyDown={onKeyDown}
      />
      <div className="absolute right-1.5 top-1/2 z-20 flex -translate-y-1/2 gap-1">
        <button type="button" tabIndex={-1} onClick={() => onChange('')} className={chipClass(total > 0 && paid <= 0)} title="Poori raqam khata par">Khata</button>
        <button type="button" tabIndex={-1} disabled={total <= 0} onClick={() => onChange(String(total))} className={chipClass(total > 0 && paid >= total)} title="Poori raqam abhi ada">Full</button>
      </div>
    </div>
  );
}

export function PayModeControl({ value, onChange, disabled }: { value: string; onChange: (value: string) => void; disabled?: boolean }) {
  return (
    <PillGroup
      label="Payment mode"
      options={PAY_MODES.map(option => ({ ...option, disabled }))}
      value={value}
      onChange={onChange}
      className="h-11 items-stretch"
    />
  );
}

/** Account the paid amount leaves from; warns when no account exists yet. */
export function AccountPicker({
  accounts, value, onChange, mode, hasShiftDrawer,
}: {
  accounts: any[];
  value: string;
  onChange: (id: string) => void;
  mode: string;
  hasShiftDrawer: boolean;
}) {
  if (accounts.length === 0) {
    return (
      <div className="flex items-start gap-2 rounded-control bg-warning-soft p-2.5 text-xs text-warning-fg ring-1 ring-inset ring-warning/25" role="alert">
        <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
        <div>
          <span className="font-bold">Koi Cash Drawer ya Bank Account nahi hai</span>
          <p className="mt-0.5 text-[11px] leading-snug">Pehle <b>Bank &amp; Cash</b> mein account banayein, ya paid amount <b>0</b> rakh kar khata par save karein.</p>
        </div>
      </div>
    );
  }
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <label htmlFor="procurement-pay-account" className="flex items-center gap-1.5 text-xs font-semibold text-fg-muted">
          <Wallet size={12} className="text-fg-subtle" aria-hidden="true" /> Paid from account
        </label>
        {mode === 'Cash' && hasShiftDrawer && <Badge tone="success" dot>Shift drawer</Badge>}
      </div>
      <Select id="procurement-pay-account" value={value} onChange={event => onChange(event.target.value)} className="w-full text-xs font-semibold">
        {accounts.map((account: any) => (
          <option key={account.id} value={account.id}>{account.name} ({account.type}) — {formatCurrency(account.balance)}</option>
        ))}
      </Select>
    </div>
  );
}
