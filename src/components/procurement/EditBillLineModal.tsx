import React, { useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, Check, Minus, Package, Plus, Trash2 } from 'lucide-react';
import { cn } from '../../lib/cn';
import { roundCurrency } from '../../lib/db';
import { formatCurrency } from '../../lib/formatters';
import { Button, Field, IconButton, Input, Modal } from '../ui';
import type { BillLine, ItemLanding } from './SuppliesPurchase';
import {
  billLineProblem, conversionText, costChangeText, findLineUnit, rateForUnit, rateFromTotal, UNIT_KIND_LABEL,
  type PurchaseUnit, type PurchaseUnitKind,
} from './purchaseStock';

const UNIT_KINDS: PurchaseUnitKind[] = ['base', 'pack', 'multi', 'convert'];

/** Quantity, rate, total and purchase unit of one supplies bill line, with where it lands. Loaded lazily. */
const EditBillLineModal: React.FC<{
  line: BillLine;
  units: PurchaseUnit[];
  baseUnit: string;
  /** This product's stock and average cost after the bill, with this line as edited. */
  landingFor: (draft: BillLine) => ItemLanding | null;
  onSave: (line: BillLine) => void;
  onRemove: (line: BillLine) => void;
  onClose: () => void;
}> = ({ line, units, baseUnit, landingFor, onSave, onRemove, onClose }) => {
  const [qty, setQty] = useState(String(line.quantity));
  const [rate, setRate] = useState(String(line.rate));
  const [total, setTotal] = useState(String(roundCurrency(line.quantity * line.rate)));
  const [unit, setUnit] = useState<PurchaseUnit | undefined>(() => findLineUnit(line, units));
  const [error, setError] = useState('');

  const draft: BillLine = useMemo(() => {
    const q = parseFloat(qty);
    const r = parseFloat(rate);
    const quantity = Number.isFinite(q) ? q : 0;
    const price = Number.isFinite(r) ? r : 0;
    return {
      ...line,
      quantity,
      rate: price,
      unit: unit?.unit || line.unit,
      unitKey: unit?.key || line.unitKey,
      conversion_factor: unit?.factor || line.conversion_factor,
      total: roundCurrency(quantity * price),
    };
  }, [line, qty, rate, unit]);
  const landing = useMemo(() => (unit ? landingFor(draft) : null), [landingFor, draft, unit]);
  // Shown live in the preview box; the Update button shows it again as the field error.
  const liveProblem = unit ? billLineProblem(draft, units) : '';
  const step = 1;

  const changeQty = (value: string) => {
    setError('');
    setQty(value);
    setTotal(String(roundCurrency((parseFloat(value) || 0) * (parseFloat(rate) || 0))));
  };
  const changeRate = (value: string) => {
    setRate(value);
    setTotal(String(roundCurrency((parseFloat(qty) || 0) * (parseFloat(value) || 0))));
  };
  // The total moves the rate: the quantity is what arrived and must stay.
  const changeTotal = (value: string) => {
    setTotal(value);
    const next = rateFromTotal(parseFloat(value), parseFloat(qty));
    if (next !== null) setRate(String(next));
  };
  const changeUnit = (next: PurchaseUnit) => {
    setError('');
    const newRate = rateForUnit(parseFloat(rate) || 0, unit?.factor || line.conversion_factor, next.factor);
    setUnit(next);
    if (newRate > 0) {
      setRate(String(newRate));
      setTotal(String(roundCurrency((parseFloat(qty) || 0) * newRate)));
    }
  };

  const save = () => {
    const problem = billLineProblem(draft, units);
    if (problem) { setError(problem); return; }
    onSave(draft);
  };

  const unitName = unit?.unit || line.unit;

  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      icon={<span className="grid size-10 place-items-center rounded-xl bg-surface-2 text-fg-muted"><Package size={18} /></span>}
      title={line.item_name}
      description={unit ? (unit.kind === 'base' ? `Unit: ${unitName} (base)` : `Unit: ${unit.equals}`) : `Unit "${line.unit}" is no longer on this product — choose one below`}
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
            <p className="mb-1.5 text-xs font-semibold text-fg-muted">Which unit was it bought in?</p>
            <div className="flex max-h-48 flex-col gap-2 overflow-y-auto pr-0.5" role="radiogroup" aria-label="Purchase unit">
              {UNIT_KINDS.map(kind => {
                const group = units.filter(u => u.kind === kind);
                if (group.length === 0) return null;
                return (
                  <div key={kind}>
                    {kind !== 'base' && <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">{UNIT_KIND_LABEL[kind]}</p>}
                    <div className="grid grid-cols-2 gap-1.5">
                      {group.map(option => {
                        const selected = unit?.key === option.key;
                        return (
                          <button
                            key={option.key}
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
                            <span className="mt-0.5 block text-[10px] font-normal text-fg-subtle">{option.kind === 'base' ? 'Base unit' : option.equals}</span>
                            <span className={cn('mt-0.5 block text-[10px] font-bold', option.kind === 'pack' ? 'text-info-fg' : 'text-success-fg')}>
                              {option.kind === 'pack' ? `Into ${option.unit} packs` : 'Into loose stock'}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <Field label={`Quantity (${unitName})`} error={error || undefined}>
          {control => (
            <div className="flex items-center gap-1.5">
              <IconButton variant="secondary" aria-label="Decrease" icon={<Minus />} disabled={!((parseFloat(qty) || 0) > step)} onClick={() => changeQty(String((parseFloat(qty) || 0) - step))} />
              <Input {...control} type="number" step="any" min="0" inputMode="decimal" value={qty} onChange={event => changeQty(event.target.value)} className="text-center text-base font-bold tabular-nums" />
              <IconButton variant="secondary" aria-label="Increase" icon={<Plus />} onClick={() => changeQty(String((parseFloat(qty) || 0) + step))} />
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
          <Field label={`Rate / ${unitName}`}>
            {control => <Input {...control} type="number" step="any" min="0" inputMode="decimal" suffix="Rs" value={rate} onChange={event => changeRate(event.target.value)} className="font-bold tabular-nums" />}
          </Field>
          <Field label="Total" hint="Changing the total changes the rate; the quantity stays the same.">
            {control => <Input {...control} type="number" step="any" min="0" inputMode="decimal" suffix="Rs" value={total} onChange={event => changeTotal(event.target.value)} className="font-bold tabular-nums" />}
          </Field>
        </div>

        {unit && (
          <div className="space-y-1.5 rounded-control bg-surface-2 px-3 py-2.5 text-xs ring-1 ring-inset ring-line" aria-live="polite">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-fg-subtle">Into stock</span>
              <span className="text-right font-bold tabular-nums text-fg">
                {conversionText(draft.quantity, unit, baseUnit)}
                <span className={cn('ml-1.5 font-semibold', unit.kind === 'pack' ? 'text-info-fg' : 'text-success-fg')}>→ {unit.lands}</span>
              </span>
            </div>
            {unit.factor !== 1 && draft.rate > 0 && (
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-fg-subtle">Rate per {baseUnit}</span>
                <span className="font-semibold tabular-nums text-fg-muted">{formatCurrency(draft.rate / unit.factor)}</span>
              </div>
            )}
            {liveProblem && !error && (
              <p className="flex items-start gap-1.5 font-semibold text-danger-fg">
                <AlertTriangle size={12} className="mt-px shrink-0" aria-hidden="true" /> {liveProblem}
              </p>
            )}
            {landing && !liveProblem && (
              <>
                {landing.landing.changes.map(change => (
                  <div key={change.id} className="flex items-baseline justify-between gap-3">
                    <span className="text-fg-subtle">{change.kind === 'loose' ? 'Loose' : `${change.name} packs`}</span>
                    <span className="flex items-center gap-1 tabular-nums text-fg-muted">{change.beforeText} <ArrowRight size={10} aria-hidden="true" /> <b className="text-fg">{change.afterText}</b></span>
                  </div>
                ))}
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-fg-subtle">Avg cost</span>
                  <span className="font-bold tabular-nums text-fg">{costChangeText(landing.landing, landing.unit)}</span>
                </div>
                {landing.landing.notes.map(note => (
                  <p key={note} className="flex items-start gap-1.5 font-semibold text-warning-fg">
                    <AlertTriangle size={12} className="mt-px shrink-0" aria-hidden="true" /> {note}
                  </p>
                ))}
              </>
            )}
          </div>
        )}
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>
    </Modal>
  );
};

export default EditBillLineModal;
