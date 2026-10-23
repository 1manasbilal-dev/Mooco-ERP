import React, { useState } from 'react';
import { Check, Minus, Package, Plus, Trash2 } from 'lucide-react';
import { cn } from '../../lib/cn';
import { roundCurrency } from '../../lib/db';
import { Button, Field, IconButton, Input, Modal } from '../ui';
import type { BillLine, PurchaseUnit } from './SuppliesPurchase';

/** Quantity, rate, total and purchase unit of one supplies bill line. Loaded lazily. */
const EditBillLineModal: React.FC<{
  line: BillLine;
  units: PurchaseUnit[];
  /** "Adds packs" / "Adds loose" hint for a unit. */
  destinationFor: (unit: PurchaseUnit) => { packed: boolean } | null;
  onSave: (line: BillLine) => void;
  onRemove: (line: BillLine) => void;
  onClose: () => void;
}> = ({ line, units, destinationFor, onSave, onRemove, onClose }) => {
  const [qty, setQty] = useState(String(line.quantity));
  const [rate, setRate] = useState(String(line.rate));
  const [total, setTotal] = useState(String(roundCurrency(line.quantity * line.rate)));
  const [unit, setUnit] = useState(line.unit || line.base_unit || 'pcs');
  const [factor, setFactor] = useState(Number(line.conversion_factor) || 1);
  const [error, setError] = useState('');

  const changeQty = (value: string) => {
    setQty(value);
    setTotal(String(roundCurrency((parseFloat(value) || 0) * (parseFloat(rate) || 0))));
  };
  const changeRate = (value: string) => {
    setRate(value);
    setTotal(String(roundCurrency((parseFloat(qty) || 0) * (parseFloat(value) || 0))));
  };
  const changeTotal = (value: string) => {
    setTotal(value);
    const r = parseFloat(rate) || 0;
    if (r > 0) setQty(Number(((parseFloat(value) || 0) / r).toFixed(2)).toString());
  };
  const changeUnit = (next: PurchaseUnit) => {
    setUnit(next.unit);
    setFactor(next.factor);
    const newRate = roundCurrency(((parseFloat(rate) || 0) / (factor || 1)) * next.factor);
    if (newRate > 0) {
      setRate(String(newRate));
      setTotal(String(roundCurrency((parseFloat(qty) || 0) * newRate)));
    }
  };

  const save = () => {
    const q = parseFloat(qty);
    const r = parseFloat(rate) || 0;
    if (!Number.isFinite(q) || q <= 0) { setError('Quantity 0 se zyada likhein'); return; }
    if (r < 0) { setError('Rate minus mein nahi ho sakta'); return; }
    onSave({ ...line, quantity: q, rate: r, unit: unit || line.unit, conversion_factor: factor || 1, total: roundCurrency(q * r) });
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      icon={<span className="grid size-10 place-items-center rounded-xl bg-surface-2 text-fg-muted"><Package size={18} /></span>}
      title={line.item_name}
      description={`Unit: ${unit}`}
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          <Button variant="danger-soft" size="sm" leftIcon={<Trash2 />} onClick={() => onRemove(line)}>Remove</Button>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button onClick={save}>Update</Button>
          </div>
        </div>
      }
    >
      <form className="flex flex-col gap-4" onSubmit={event => { event.preventDefault(); save(); }}>
        {units.length > 1 && (
          <div>
            <p className="mb-1.5 text-xs font-semibold text-fg-muted">Purchase unit / packaging</p>
            <div className="grid max-h-36 grid-cols-2 gap-1.5 overflow-y-auto" role="radiogroup" aria-label="Purchase unit">
              {units.map(option => {
                const selected = unit === option.unit;
                const dest = destinationFor(option);
                return (
                  <button
                    key={option.unit}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => changeUnit(option)}
                    className={cn(
                      'cursor-pointer rounded-control p-2 text-left text-xs ring-1 ring-inset transition-colors',
                      selected ? 'bg-brand-soft font-bold text-brand-fg ring-brand/40' : 'bg-surface-2 text-fg-muted ring-line hover:ring-line-strong',
                    )}
                  >
                    <span className="flex items-center justify-between gap-1"><span className="truncate">{option.unit}</span>{selected && <Check size={12} className="shrink-0" aria-hidden="true" />}</span>
                    <span className="mt-0.5 block text-[10px] font-normal text-fg-subtle">{option.factor === 1 ? 'Base unit' : `= ${option.factor} ${line.base_unit || 'base'}`}</span>
                    {dest && <span className={cn('mt-0.5 block text-[10px] font-bold', dest.packed ? 'text-warning-fg' : 'text-success-fg')}>{dest.packed ? 'Adds packs' : 'Adds loose'}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <Field label={`Quantity (${unit})`} error={error || undefined}>
          {control => (
            <div className="flex items-center gap-1.5">
              <IconButton variant="secondary" aria-label="Kam karein" icon={<Minus />} onClick={() => changeQty(String(Math.max(0.1, (parseFloat(qty) || 1) - 1)))} />
              <Input {...control} type="number" step="any" min="0.1" inputMode="decimal" value={qty} onChange={event => { setError(''); changeQty(event.target.value); }} className="text-center text-base font-bold tabular-nums" />
              <IconButton variant="secondary" aria-label="Zyada karein" icon={<Plus />} onClick={() => changeQty(String((parseFloat(qty) || 0) + 1))} />
            </div>
          )}
        </Field>
        <div className="-mt-2 flex flex-wrap gap-1.5">
          {[1, 2, 5, 10, 25, 50].map(value => (
            <button key={value} type="button" onClick={() => changeQty(String(value))} className="h-7 cursor-pointer rounded-lg bg-surface-2 px-2.5 text-[11px] font-semibold text-fg-muted ring-1 ring-inset ring-line transition-colors hover:bg-brand-soft hover:text-brand-fg">
              {value}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label={`Rate / ${unit}`}>
            {control => <Input {...control} type="number" step="any" min="0" inputMode="decimal" suffix="Rs" value={rate} onChange={event => changeRate(event.target.value)} className="font-bold tabular-nums" />}
          </Field>
          <Field label="Total" hint="Total badalne se quantity khud update ho jati hai.">
            {control => <Input {...control} type="number" step="any" min="0" inputMode="decimal" suffix="Rs" value={total} onChange={event => changeTotal(event.target.value)} className="font-bold tabular-nums" />}
          </Field>
        </div>
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>
    </Modal>
  );
};

export default EditBillLineModal;
