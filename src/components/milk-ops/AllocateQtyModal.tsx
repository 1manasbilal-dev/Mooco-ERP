import React, { useRef, useState } from 'react';
import { Check, SlidersHorizontal } from 'lucide-react';
import { Badge, Button, Field, Input, Modal, Money } from '../ui';
import { cn } from '../../lib/cn';
import { formatCurrency, formatQty } from '../../lib/formatters';
import { parseQty, qtyInputValue } from './milkOps';
import type { SourceEntry } from './AllocationRows';

interface AllocateQtyModalProps {
  entry: SourceEntry;
  /** Litres already in the cart for this row, or null when it is not in the cart yet. */
  cartQty: number | null;
  onSubmit: (litres: number) => void;
  onRemove: () => void;
  onClose: () => void;
}

/** Choose how many litres of one lot (or counter item) go into the allocation cart. Lazy-loaded. */
export default function AllocateQtyModal({ entry, cartQty, onSubmit, onRemove, onClose }: AllocateQtyModalProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const max = Math.max(0, entry.available);
  const [text, setText] = useState(() => qtyInputValue(cartQty ?? max));
  const [touched, setTouched] = useState(false);
  const qty = parseQty(text);
  const error = !(qty > 0) ? 'Enter a qty above 0.' : qty > max + 0.001 ? `Only ${formatQty(max, 3)} L left.` : '';

  const presets = [
    { label: '5 L', value: 5 },
    { label: '10 L', value: 10 },
    // Rounded down to 3 decimals so half never asks for more than is there.
    { label: 'Half', value: Math.floor((max / 2) * 1000) / 1000 },
    { label: `All (${formatQty(max, 3)} L)`, value: max },
  ].filter((preset, index, list) => preset.value > 0 && preset.value <= max + 0.001 && list.findIndex(p => p.value === preset.value) === index);

  const submit = (event?: React.FormEvent) => {
    event?.preventDefault();
    setTouched(true);
    if (error) {
      inputRef.current?.focus();
      return;
    }
    onSubmit(Math.round(qty * 1000) / 1000);
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Allocate milk volume"
      description={entry.name}
      initialFocusRef={inputRef}
      icon={
        <span className="flex size-10 items-center justify-center rounded-xl bg-brand-soft text-brand-fg">
          <SlidersHorizontal className="size-5" aria-hidden="true" />
        </span>
      }
      footer={
        <>
          {cartQty !== null ? (
            <Button variant="danger-soft" onClick={onRemove}>Remove from cart</Button>
          ) : (
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
          )}
          <Button type="submit" form="allocate-qty-form" leftIcon={<Check />} className="sm:min-w-40">
            {cartQty !== null ? 'Update cart' : 'Add to cart'}
          </Button>
        </>
      }
    >
      <form id="allocate-qty-form" onSubmit={submit} className="space-y-4" noValidate>
        <dl className="grid grid-cols-3 gap-2 rounded-control border border-line bg-surface-2 p-3 text-xs">
          <div className="min-w-0">
            <dt className="text-fg-subtle">Type</dt>
            <dd className="mt-1">
              {entry.source === 'retail' ? <Badge tone="info">Counter</Badge> : entry.isReturn ? <Badge tone="warning">Return</Badge> : <Badge>{entry.milkType}</Badge>}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-fg-subtle">Cost</dt>
            <dd className="mt-1 text-sm font-bold tabular-nums text-fg">{formatCurrency(entry.rate)}/L</dd>
          </div>
          <div className="min-w-0 text-right">
            <dt className="text-fg-subtle">Left</dt>
            <dd className="mt-1 text-sm font-bold tabular-nums text-fg">{formatQty(max, 3)} L</dd>
            {entry.stockNote && <dd className="mt-0.5 text-[11px] tabular-nums text-fg-subtle">{entry.stockNote}</dd>}
          </div>
        </dl>

        <Field label="How much milk to allocate" required error={touched ? error : undefined}>
          {control => (
            <Input
              {...control}
              ref={inputRef}
              inputSize="lg"
              inputMode="decimal"
              autoComplete="off"
              value={text}
              onChange={event => { setText(event.target.value.replace(/[^\d.]/g, '')); setTouched(true); }}
              onFocus={event => event.target.select()}
              suffix="L"
              placeholder="0"
              className="text-xl font-bold tabular-nums"
            />
          )}
        </Field>

        {presets.length > 0 && (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Quick quantities">
            {presets.map(preset => {
              const active = Math.abs(qty - preset.value) < 0.001;
              return (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => { setText(qtyInputValue(preset.value)); setTouched(true); inputRef.current?.focus(); }}
                  aria-pressed={active}
                  className={cn(
                    'h-9 cursor-pointer rounded-lg px-3 text-xs font-semibold ring-1 ring-inset transition-colors duration-150',
                    active ? 'bg-brand text-brand-on ring-transparent' : 'bg-surface text-fg-muted ring-line hover:bg-surface-2 hover:text-fg',
                  )}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>
        )}

        <div className="flex items-center justify-between border-t border-line pt-3 text-sm">
          <span className="text-fg-subtle">Estimated value</span>
          <Money amount={Math.max(0, qty) * entry.rate} className="font-bold text-fg" />
        </div>
      </form>
    </Modal>
  );
}
