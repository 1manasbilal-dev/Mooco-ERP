import React from 'react';
import { ArrowLeftRight, Banknote, CircleCheck, Wallet } from 'lucide-react';
import type { POSBill } from '../../types';
import { formatCurrency } from '../../lib/formatters';
import { Button, Field, Modal, Money, Select } from '../ui';
import { ChoiceCard, PaymentModeBadge, SummaryRow } from './SalesBits';

type AccountOption = { id: string; name: string; type: string; balance: number; isActive?: boolean };

export interface PaymentModeDialogProps {
  sale: POSBill;
  targetMode: 'Cash' | 'Online';
  targetAccountId: string;
  accounts: AccountOption[];
  saving: boolean;
  onTargetModeChange: (mode: 'Cash' | 'Online') => void;
  onTargetAccountChange: (accountId: string) => void;
  onSubmit: (event: React.FormEvent) => void;
  onClose: () => void;
}

const FORM_ID = 'sale-payment-mode-form';

/** Cash ⇄ Online correction for a bill. Lazy-loaded by Sales History; all logic stays in the page. */
export default function PaymentModeDialog({
  sale, targetMode, targetAccountId, accounts, saving, onTargetModeChange, onTargetAccountChange, onSubmit, onClose,
}: PaymentModeDialogProps) {
  const options = accounts
    .filter(a => a.isActive !== false)
    .filter(a => targetMode === 'Online' ? (a.type === 'Bank' || a.type === 'Wallet') : (a.type === 'Cash' || a.type === 'Drawer'));

  return (
    <Modal
      open
      onClose={onClose}
      dismissible={!saving}
      size="md"
      title="Payment Mode Tabdeel Karein"
      description={<span className="tabular-nums">Bill #{sale.bill_number} • {formatCurrency(sale.total || 0)}</span>}
      icon={
        <span className="flex size-10 items-center justify-center rounded-control bg-info-soft text-info-fg">
          <ArrowLeftRight className="size-5" aria-hidden="true" />
        </span>
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="submit" form={FORM_ID} loading={saving} disabled={!targetAccountId} leftIcon={<ArrowLeftRight />}>
            {saving ? 'Tabdeel Ho Raha Hy...' : `Tabdeel Karein (${targetMode})`}
          </Button>
        </>
      }
    >
      <form id={FORM_ID} onSubmit={onSubmit}>
        <fieldset disabled={saving} className="min-w-0 space-y-4">
          <div className="space-y-2 rounded-control bg-surface-2 p-3 text-sm ring-1 ring-inset ring-line/70">
            <SummaryRow label="Customer">{sale.customer_name || 'Walk-in Customer'}</SummaryRow>
            <SummaryRow label="Current Mode"><PaymentModeBadge mode={sale.payment_mode} /></SummaryRow>
            <div className="flex items-center justify-between gap-3 border-t border-line pt-2">
              <span className="text-fg-subtle">Bill Amount</span>
              <Money amount={sale.total || 0} className="text-base font-bold text-fg" />
            </div>
          </div>

          <div role="group" aria-labelledby={`${FORM_ID}-mode`}>
            <p id={`${FORM_ID}-mode`} className="mb-2 text-xs font-semibold text-fg-muted">Naya Payment Mode Muntakhib Karein</p>
            <div className="grid grid-cols-2 gap-2">
              <ChoiceCard
                selected={targetMode === 'Cash'}
                onSelect={() => onTargetModeChange('Cash')}
                icon={<Banknote />}
                title="Cash (Drawer)"
                description="Physical drawer me jama hoga"
              />
              <ChoiceCard
                selected={targetMode === 'Online'}
                onSelect={() => onTargetModeChange('Online')}
                icon={<Wallet />}
                title="Online Transfer"
                description="Bank / Digital Wallet me jama"
              />
            </div>
          </div>

          <Field label={targetMode === 'Online' ? 'Muntakhib Bank / Digital Wallet Account' : 'Muntakhib Cash Account'}>
            {control => (
              <Select {...control} value={targetAccountId} onChange={event => onTargetAccountChange(event.target.value)} required>
                <option value="">-- Account Select Karein --</option>
                {options.map(acc => (
                  <option key={acc.id} value={acc.id}>
                    {acc.name} ({acc.type}) - Balance: {formatCurrency(acc.balance)}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <div className="flex items-start gap-2.5 rounded-control bg-info-soft p-3 text-xs text-info-fg">
            <CircleCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <div>
              <p className="font-bold">Automatic Financial Balancing:</p>
              <p className="mt-0.5 leading-snug">
                {sale.payment_mode === 'Cash' && targetMode === 'Online'
                  ? 'Cash Drawer se yeh raqam nikaal kar muntakhib Bank Account me credit ho jayegi. Drawer closing bilkul exact aur barabar rahegi.'
                  : 'Bank account se raqam nikaal kar Cash Drawer me add ho jayegi.'}
              </p>
            </div>
          </div>
        </fieldset>
      </form>
    </Modal>
  );
}
