import React, { useRef, useState } from 'react';
import { PencilLine, RotateCcw } from 'lucide-react';
import { useDairy } from '../../context/DairyContext';
import { useToast } from '../../context/ToastContext';
import { roundCurrency } from '../../lib/db';
import { formatQty } from '../../lib/formatters';
import { Button, Field, Input, Modal, Money, Select } from '../ui';
import { SmartNumberInput } from '../SmartNumberInput';
import { PillGroup } from './ProcurementUI';
import { settlementOf } from './procurementData';

export const MILK_ENTRY_ERROR = 'Data Entry Error / Cancel Intake';

const MILK_REASONS = [
  { value: 'Substandard Quality / Curdled', label: 'Substandard Quality / Curdled' },
  { value: MILK_ENTRY_ERROR, label: 'Data Entry Error / Cancel' },
  { value: 'Other', label: 'Other Reason...' },
];
const MATERIAL_REASONS = [
  { value: 'Defective / Damaged Material', label: 'Defective / Damaged' },
  { value: 'Quality Substandard', label: 'Quality Substandard' },
  { value: 'Data Entry Error', label: 'Data Entry Error' },
  { value: 'Other', label: 'Other Reason...' },
];

export interface ReturnRequest {
  entry: any;
  type: 'milk' | 'material';
  maxQty: number;
  supplierName: string;
  /** Opened from "Correct entry": a full return as a data-entry error, then the slip goes back into the form. */
  correct?: boolean;
}

/**
 * Return a purchase (or part of it) to the supplier. A wrong milk slip is corrected by returning it
 * in full as a data-entry error and typing it again, so the khata and drawer stay balanced.
 */
const ReturnPurchaseModal: React.FC<{
  request: ReturnRequest | null;
  onClose: () => void;
  /** After a successful return; `refill` asks the milk form to load the slip again for correction. */
  onReturned?: (entry: any, refill: boolean) => void;
}> = ({ request, onClose, onReturned }) => {
  const { returnPurchase, returnMaterialPurchase } = useDairy();
  const { showToast } = useToast();
  const isMilk = request?.type === 'milk';
  const [qty, setQty] = useState<string>(() => String(request?.maxQty ?? ''));
  const [reason, setReason] = useState(() => (request?.correct ? MILK_ENTRY_ERROR : isMilk ? MILK_REASONS[0].value : MATERIAL_REASONS[0].value));
  const [customReason, setCustomReason] = useState('');
  const [refundAs, setRefundAs] = useState<'cash' | 'khata'>('cash');
  const [refill, setRefill] = useState(true);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  if (!request) return null;
  const { entry, maxQty, supplierName } = request;
  const numQty = parseFloat(qty);
  const isFull = numQty >= maxQty - 0.0005;
  const canRefill = isMilk && reason === MILK_ENTRY_ERROR && isFull;

  const { amount: entryTotal, paid: entryPaid } = settlementOf(entry);
  const billTotal = entryTotal || (Number(entry.quantity || 0) * Number(entry.rate || 0));
  const hasAccount = Boolean(entry.details?.account_id || entry.account_id);
  const returnValue = roundCurrency((Number.isFinite(numQty) ? numQty : 0) * Number(entry.rate || 0));
  const cashPart = refundAs === 'cash' && hasAccount && billTotal > 0 ? roundCurrency(Math.min(entryPaid, returnValue * (entryPaid / billTotal))) : 0;
  const khataPart = roundCurrency(Math.max(0, returnValue - cashPart));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    // Enter pressed twice submits before the disabled button re-renders; a second return would
    // refund and lower the khata again.
    if (busy || busyRef.current) return;
    if (!Number.isFinite(numQty) || numQty <= 0) {
      showToast('Please enter a valid return quantity greater than 0', 'warning');
      return;
    }
    if (numQty > maxQty + 0.0005) {
      showToast(`Return quantity cannot exceed available limit of ${formatQty(maxQty)}`, 'warning');
      return;
    }
    const finalReason = reason === 'Other' ? (customReason.trim() || 'Other Return') : reason;
    busyRef.current = true;
    setBusy(true);
    let success = false;
    try {
      success = isMilk
        ? await returnPurchase(entry.id, numQty, finalReason, refundAs)
        : await returnMaterialPurchase(entry.id, numQty, finalReason, refundAs);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
    if (success) {
      onReturned?.(entry, canRefill && refill);
      onClose();
    }
  };

  const reasons = isMilk ? MILK_REASONS : MATERIAL_REASONS;
  const unit = isMilk ? 'L' : entry.unit;

  return (
    <Modal
      open
      onClose={onClose}
      dismissible={!busy}
      size="md"
      icon={
        <span className="grid size-10 place-items-center rounded-xl bg-warning-soft text-warning-fg">
          {request.correct ? <PencilLine size={18} /> : <RotateCcw size={18} />}
        </span>
      }
      title={request.correct ? 'Galat entry theek karein' : 'Return to supplier'}
      description={supplierName}
    >
      <form onSubmit={submit} className="space-y-4 pb-1">
        <div className="flex items-center justify-between gap-3 rounded-control bg-surface-2 px-3 py-2.5 text-xs ring-1 ring-inset ring-line">
          <span className="text-fg-subtle">Original entry</span>
          <span className="text-right font-bold tabular-nums text-fg">
            {isMilk
              ? `${formatQty(entry.quantity)} L · ${entry.milk_type} · ${entry.shift}`
              : `${formatQty(entry.quantity)} ${entry.unit} · ${entry.item_name}`}
            {' · '}<Money amount={entryTotal} />
          </span>
        </div>

        <Field label="Return quantity" required hint={<>Max <b className="tabular-nums text-fg">{formatQty(maxQty)} {unit}</b> (jo abhi production mein nahi gaya)</>}>
          {control => (
            <div className="flex items-center gap-1.5">
              <div className="min-w-0 flex-1">
                <SmartNumberInput
                  {...control}
                  inputMode="decimal"
                  className="ds-control h-10 w-full rounded-control border border-line bg-surface px-3 text-sm font-bold tabular-nums text-fg shadow-e1 outline-none focus:border-brand-accent focus:ring-4 focus:ring-ring/20"
                  value={qty}
                  onChange={setQty}
                />
              </div>
              <Button variant="secondary" onClick={() => setQty(String(maxQty))}>Full</Button>
            </div>
          )}
        </Field>

        <Field label="Reason" required>
          {control => (
            <Select {...control} value={reason} onChange={event => setReason(event.target.value)} className="w-full">
              {reasons.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </Select>
          )}
        </Field>
        {reason === 'Other' && (
          <Input required aria-label="Wajah" placeholder="Wajah likhein…" value={customReason} onChange={event => setCustomReason(event.target.value)} />
        )}

        <div className="space-y-2.5 rounded-control bg-surface-2 p-3 text-xs ring-1 ring-inset ring-line">
          {entryPaid > 0 && hasAccount && (
            <PillGroup
              label="Refund kaise hoga"
              size="sm"
              options={[{ value: 'cash', label: 'Cash wapas mila' }, { value: 'khata', label: 'Sirf khata kam' }]}
              value={refundAs}
              onChange={value => setRefundAs(value as 'cash' | 'khata')}
            />
          )}
          <div className="flex items-baseline justify-between">
            <span className="text-fg-subtle">Return value</span>
            <Money amount={returnValue} className="text-base font-bold text-fg" />
          </div>
          {cashPart > 0 && <p className="flex items-center gap-1.5 text-success-fg"><span className="size-1.5 rounded-full bg-success" aria-hidden="true" /><Money amount={cashPart} /> account mein wapas aayenge</p>}
          {khataPart > 0 && <p className="flex items-center gap-1.5 text-warning-fg"><span className="size-1.5 rounded-full bg-warning" aria-hidden="true" /><Money amount={khataPart} /> supplier ke khaate se kam honge</p>}
        </div>

        {canRefill && (
          <label className="flex cursor-pointer items-start gap-2.5 rounded-control p-1 text-xs text-fg-muted">
            <input type="checkbox" checked={refill} onChange={event => setRefill(event.target.checked)} className="mt-0.5 size-4 accent-[rgb(var(--brand))]" />
            <span><b className="text-fg">Return ke baad form mein dobara bharein</b> — sahi liter ya rate likh kar nayi entry save karein.</span>
          </label>
        )}

        <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
          <Button variant="secondary" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="danger" loading={busy} leftIcon={<RotateCcw />}>
            {busy ? 'Processing…' : request.correct ? 'Return & theek karein' : 'Confirm return'}
          </Button>
        </div>
      </form>
    </Modal>
  );
};

export default ReturnPurchaseModal;
