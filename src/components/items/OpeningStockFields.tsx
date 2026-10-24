import React from 'react';
import { Info, Layers } from 'lucide-react';
import type { ItemVariant } from '../../types';
import { Button, Field, Input, Money } from '../ui';
import { formatBaseQty } from '../../lib/stockRules';
import { sellUnitContains } from '../../lib/sellUnits';
import { readyMadePacks, valueAtCost, type OpeningStockCheck, type OpeningStockDraft } from './catalogModel';

interface Props {
  baseUnit: string;
  costRate: number;
  /** The form's sell units: ready-made packs get a count field, multi-units only a note. */
  variants: ItemVariant[];
  draft: OpeningStockDraft;
  onChange: (next: OpeningStockDraft) => void;
  check: OpeningStockCheck;
  showErrors: boolean;
  /** Why the fields are read-only (no permission), if they are. */
  disabledReason?: string;
  onOpenSellUnits: () => void;
}

const blurOnWheel = (event: React.WheelEvent<HTMLInputElement>) => event.currentTarget.blur();

/** Loose stock in the base unit plus a count per ready-made pack, saved as one "Opening Stock" move. */
export function OpeningStockFields({ baseUnit, costRate, variants, draft, onChange, check, showErrors, disabledReason, onOpenSellUnits }: Props) {
  const packs = readyMadePacks(variants);
  const multis = variants.filter(v => v.deduct_from_base === true);
  const noUnit = !baseUnit;
  const disabled = Boolean(disabledReason) || noUnit;
  const value = valueAtCost(check.totalBase, costRate);

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label={`Loose stock${baseUnit ? ` (${baseUnit})` : ''}`}
          error={showErrors ? check.errors.loose : undefined}
          hint={noUnit ? 'Choose a base unit first.' : 'Loose stock, in the base unit. Empty = 0.'}
        >
          {control => (
            <Input {...control} type="number" inputMode="decimal" min="0" step="any" placeholder="0" suffix={baseUnit || undefined}
              className="tabular-nums" disabled={disabled} value={draft.loose} onWheel={blurOnWheel}
              onChange={event => onChange({ ...draft, loose: event.target.value })} />
          )}
        </Field>
        {packs.map(v => (
          <Field
            key={v.id}
            label={`${v.name}${v.isActive === false ? ' (hidden)' : ''}`}
            error={showErrors ? check.errors.packs[v.id] : undefined}
            hint={`How many packs? 1 pack = ${formatBaseQty(sellUnitContains(v), baseUnit || 'unit')}`}
          >
            {control => (
              <Input {...control} type="number" inputMode="numeric" min="0" step="1" placeholder="0" suffix="packs"
                className="tabular-nums" disabled={disabled} value={draft.packs[v.id] || ''} onWheel={blurOnWheel}
                onChange={event => onChange({ ...draft, packs: { ...draft.packs, [v.id]: event.target.value } })} />
            )}
          </Field>
        ))}
      </div>

      {packs.length === 0 && (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-subtle">
          <Info className="size-3.5 shrink-0" />
          To enter stock for ready-made packs (e.g. 500 g pouch), add the pack first.
          <Button size="sm" variant="ghost" onClick={onOpenSellUnits}>Sell units</Button>
        </p>
      )}
      {multis.length > 0 && (
        <p className="flex items-start gap-1.5 text-xs text-fg-subtle">
          <Layers className="mt-0.5 size-3.5 shrink-0" />
          {multis.map(v => v.name).join(', ')}: no stock of their own, they sell from loose {baseUnit || 'stock'}.
        </p>
      )}

      {!check.isEmpty && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-control bg-surface-2 px-3.5 py-2.5 text-sm">
          <span className="font-semibold text-fg">Total: {formatBaseQty(check.totalBase, baseUnit || 'unit')}</span>
          <span className="text-xs text-fg-subtle">
            {costRate > 0 ? <>Value <Money amount={value} className="font-semibold text-fg-muted" /> (at cost)</> : 'Enter the cost so the stock value is right.'}
          </span>
        </div>
      )}
      {disabledReason && <p className="text-xs font-medium text-warning-fg">{disabledReason}</p>}
    </div>
  );
}
