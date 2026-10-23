import React, { Suspense, lazy, useMemo, useState } from 'react';
import { ArrowRight, Plus } from 'lucide-react';
import { Button, Field, Input, Modal, Money, Select } from '../ui';
import { useDairy } from '../../context/DairyContext';
import { roundCurrency } from '../../lib/db';
import { formatCurrency } from '../../lib/formatters';
import { CountInput } from './CashBits';
import { parseCashInput, useLatest } from './cashFormat';
import { denominationPieces, denominationTotal, type DenominationCounts } from './denominations';
import type { RunAction } from './useCashData';

const DenominationDialog = lazy(() => import('../DenominationDialog').then(module => ({ default: module.DenominationDialog })));

interface AddOpeningCashDialogProps {
  drawerAccountId: string;
  onClose: () => void;
  run: RunAction;
  busyKey: string | null;
}

/** Head loads a float into a drawer. The cash always moves from another tracked account. */
const AddOpeningCashDialog: React.FC<AddOpeningCashDialogProps> = ({ drawerAccountId, onClose, run, busyKey }) => {
  const { accounts, cashHandovers, addDrawerOpeningCash } = useDairy();
  const addRef = useLatest(addDrawerOpeningCash);
  const [amountRaw, setAmountRaw] = useState('');
  const [denominations, setDenominations] = useState<DenominationCounts>({});
  const [countOpen, setCountOpen] = useState(false);
  const [sourceId, setSourceId] = useState('');
  const [note, setNote] = useState('');
  const [tried, setTried] = useState(false);

  const drawer = accounts.find(account => account.id === drawerAccountId);
  const sources = useMemo(() => accounts.filter(account => account.isActive !== false && account.id !== drawerAccountId), [accounts, drawerAccountId]);
  const source = sources.find(account => account.id === sourceId);
  // A pending handover on this drawer is replaced; its cash is already in the drawer, so only the
  // difference moves from the source (same rule as addDrawerOpeningCash).
  const replaced = useMemo(
    () => roundCurrency(cashHandovers.filter(handover => handover.drawer_id === drawerAccountId && handover.status === 'Pending').reduce((sum, handover) => sum + Number(handover.declared_amount || 0), 0)),
    [cashHandovers, drawerAccountId],
  );

  const amount = parseCashInput(amountRaw);
  const noteTotal = denominationTotal(denominations);
  const netMove = roundCurrency(Math.max(0, amount.value - replaced));
  const busyId = `opening:${drawerAccountId}`;
  const busy = busyKey === busyId;

  const amountError = !amount.empty && !amount.valid
    ? 'Sahi raqam likhein.'
    : (tried || !amount.empty) && amount.valid && amount.value <= 0
      ? 'Amount 0 se zyada honi chahiye.'
      : amount.valid && amount.value > 0 && amount.value < replaced
        ? `Drawer mein pehle se ${formatCurrency(replaced)} pending hai — opening is se kam declare nahi ho sakti.`
        : tried && amount.empty ? 'Amount likhein.' : undefined;
  const sourceError = sources.length === 0
    ? 'Koi dusra account mojood nahi — pehle Bank & Cash mein ek aur account banayein.'
    : tried && !sourceId
      ? 'Source account chunein — cash kahan se aa rahi hai?'
      : source && Number(source.balance || 0) < netMove
        ? `${source.name} mein sirf ${formatCurrency(source.balance)} hai — ${formatCurrency(netMove)} transfer nahi ho sakti.`
        : undefined;
  const ready = amount.valid && amount.value > 0 && amount.value >= replaced && Boolean(source) && Number(source?.balance || 0) >= netMove;

  const handleAmountChange = (value: string) => {
    setAmountRaw(value);
    // A typed amount wins; a note count that no longer matches it is dropped rather than silently used instead.
    if (noteTotal > 0 && parseCashInput(value).value !== noteTotal) setDenominations({});
  };

  const submit = () => {
    setTried(true);
    if (!ready) return;
    void run(busyId, async () => {
      const ok = await addRef.current(drawerAccountId, amount.value, note.trim() || undefined, sourceId);
      if (ok) onClose();
      return ok;
    });
  };

  return (
    <Modal
      open
      onClose={onClose}
      dismissible={!busy}
      size="md"
      title="Add opening cash"
      description={`${drawer?.name || 'Drawer'} — agli shift isi cash se start hogi.`}
      icon={<span className="flex size-10 items-center justify-center rounded-xl bg-info-soft text-info-fg"><Plus size={20} /></span>}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button leftIcon={<Plus />} loading={busy} disabled={busyKey !== null && !busy} onClick={submit}>Add to drawer</Button>
        </>
      )}
    >
      <div className="flex flex-col gap-4">
        <Field label="Amount" required error={amountError}>
          {control => (
            <CountInput
              id={control.id}
              aria-describedby={control['aria-describedby']}
              invalid={Boolean(control['aria-invalid'])}
              value={amountRaw}
              onChange={handleAmountChange}
              onCount={() => setCountOpen(true)}
              denominationTotal={noteTotal}
              denominationPieces={denominationPieces(denominations)}
              placeholder="5000"
              disabled={busy}
            />
          )}
        </Field>

        <Field label="Cash kahan se aa rahi hai? (source account)" required error={sourceError}>
          {control => (
            <Select {...control} value={sourceId} onChange={event => setSourceId(event.target.value)} disabled={busy || sources.length === 0}>
              <option value="">Source account chunein…</option>
              {sources.map(option => (
                <option key={option.id} value={option.id}>{option.name} ({option.type}) · {formatCurrency(option.balance)}</option>
              ))}
            </Select>
          )}
        </Field>

        {source && amount.valid && amount.value > 0 && !sourceError && (
          <div className="flex flex-wrap items-center gap-2 rounded-control bg-surface-2 px-3 py-2.5 text-[13px] text-fg-muted ring-1 ring-inset ring-line/70">
            <span className="font-semibold">{source.name}</span>
            <Money amount={-netMove} tone="signed" className="font-bold" />
            <ArrowRight className="size-3.5 text-fg-faint" aria-hidden="true" />
            <span className="font-semibold">{drawer?.name || 'Drawer'}</span>
            <Money amount={netMove} tone="signed" className="font-bold" />
            <span className="w-full text-xs text-fg-subtle">
              Dono taraf ledger entry banegi.
              {replaced > 0 && ` Drawer mein pehle se ${formatCurrency(replaced)} pending hai — nayi opening ${formatCurrency(amount.value)} us ki jagah legi.`}
            </span>
          </div>
        )}

        <Field label="Note (optional)">
          {control => <Input {...control} value={note} onChange={event => setNote(event.target.value)} placeholder="e.g. Counter float load" disabled={busy} />}
        </Field>
      </div>

      {countOpen && (
        <Suspense fallback={null}>
          <DenominationDialog
            open
            onClose={() => setCountOpen(false)}
            value={denominations}
            onChange={setDenominations}
            onApply={total => setAmountRaw(String(total))}
            title="Opening cash count"
            subtitle={`${drawer?.name || 'Drawer'} mein jane wale notes`}
          />
        </Suspense>
      )}
    </Modal>
  );
};

export default AddOpeningCashDialog;
