import React from 'react';
import { AlertTriangle, EyeOff } from 'lucide-react';
import { Badge, Button, Money } from '../ui';
import { cn } from '../../lib/cn';
import { formatQty } from '../../lib/formatters';
import { formatBaseQty } from '../../lib/stockRules';
import { readPileCount, type CountPile } from './inventoryStock';

// Pieces shared by the Inventory stock count and the day-close stock count.

export const signedQty = (value: number, digits = 3) => `${value > 0 ? '+' : ''}${formatQty(value, digits)}`;
export const diffTone = (value: number) => (value > 0 ? 'text-success-fg' : value < 0 ? 'text-danger-fg' : 'text-fg-subtle');

interface PileCountRowProps {
  pile: CountPile;
  baseUnit: string;
  value: string;
  onChange: (value: string) => void;
  showError: boolean;
  /** Prefix for the input id, so the same pile id can appear for several items. */
  idPrefix?: string;
  /** Shown before the pile name (the product name in the day-close list). */
  label?: string;
  disabled?: boolean;
  inputRef?: React.Ref<HTMLInputElement>;
}

/** One pile: system count, the counted box, and the difference in its own unit and in the base unit. */
export function PileCountRow({ pile, baseUnit, value, onChange, showError, idPrefix = 'count', label, disabled, inputRef }: PileCountRowProps) {
  const read = readPileCount(pile, value);
  const inputId = `${idPrefix}-${pile.id}`;
  const errorId = `${inputId}-error`;
  const stray = pile.kind === 'stray';
  const ownUnit = pile.kind === 'loose' ? baseUnit : stray ? '' : 'packs';
  const name = label ? `${label} — ${pile.name}` : pile.name;
  const title = (
    <>
      {name}
      {pile.kind === 'pack' && <span className="text-[11px] font-medium text-fg-subtle">{formatBaseQty(pile.contains, baseUnit)} har pack</span>}
      {pile.kind === 'pack' && pile.hidden && <Badge icon={<EyeOff aria-hidden="true" />}>Hidden</Badge>}
      {stray && <Badge tone="warning" icon={<AlertTriangle aria-hidden="true" />}>Purani ginti</Badge>}
    </>
  );
  return (
    <li className={cn('px-3 py-2.5', stray && 'bg-warning-soft/40')}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1 basis-40">
          {stray
            ? <p className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-fg">{title}</p>
            : <label htmlFor={inputId} className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-fg">{title}</label>}
          <p className={cn('text-[11px] tabular-nums', pile.system < 0 ? 'font-semibold text-danger-fg' : 'text-fg-subtle')}>
            System: {formatQty(pile.system, 3)} {pile.unitLabel}
            {stray && <span className="text-warning-fg"> · kisi pile ki nahi, 0 kar dein</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {stray ? (
            <Button
              size="sm"
              variant={value === '0' ? 'primary' : 'secondary'}
              aria-pressed={value === '0'}
              aria-label={`${name}: purani ginti 0 karein`}
              disabled={disabled}
              onClick={() => onChange(value === '0' ? '' : '0')}
            >
              {value === '0' ? '0 hoga' : '0 karein'}
            </Button>
          ) : (
            <input
              id={inputId}
              ref={inputRef}
              inputMode={pile.wholeOnly ? 'numeric' : 'decimal'}
              autoComplete="off"
              placeholder="—"
              value={value}
              disabled={disabled}
              onChange={event => onChange(event.target.value.replace(pile.wholeOnly ? /[^\d]/g : /[^\d.]/g, ''))}
              aria-invalid={read.error ? true : undefined}
              aria-describedby={read.error ? errorId : undefined}
              className={cn(
                'ds-control h-10 w-24 rounded-control border bg-surface px-2.5 text-right text-sm font-bold tabular-nums text-fg outline-none focus:border-brand-accent focus:ring-4 focus:ring-ring/20 disabled:bg-surface-2',
                read.error && showError ? 'border-danger' : 'border-line',
              )}
            />
          )}
          {!stray && <span className="w-10 text-[11px] font-semibold text-fg-subtle">{ownUnit}</span>}
        </div>
        <div className="w-28 shrink-0 text-right">
          {read.counted === null ? (
            <span className="text-xs text-fg-faint">—</span>
          ) : read.diff === 0 ? (
            <Badge tone="success">Match</Badge>
          ) : (
            <>
              <p className={cn('text-sm font-bold tabular-nums', diffTone(read.diff))}>{signedQty(read.diff)} <span className="text-[11px] font-semibold">{ownUnit}</span></p>
              {pile.kind === 'pack' && <p className="text-[11px] tabular-nums text-fg-subtle">= {signedQty(read.baseDiff)} {baseUnit}</p>}
              {stray && <p className="text-[11px] text-fg-subtle">stock par asar nahi</p>}
            </>
          )}
        </div>
      </div>
      {read.error && showError && <p id={errorId} className="mt-1 text-xs font-semibold text-danger-fg">{read.error}</p>}
    </li>
  );
}

/** What saving a count will move, in the base unit and at cost, before anything is saved. */
export function CountTotals({ changes, baseDiff, unit, valueDiff }: { changes: number; baseDiff: number; unit?: string; valueDiff: number | null }) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-between gap-2 rounded-control border px-3 py-2.5',
        changes === 0 || (baseDiff === 0 && !valueDiff) ? 'border-line bg-surface-2' : (unit ? baseDiff : valueDiff || 0) > 0 ? 'border-success/25 bg-success-soft' : 'border-danger/25 bg-danger-soft',
      )}
    >
      <span className="text-xs font-semibold text-fg-muted">
        {changes === 0 ? 'Abhi koi farq nahi' : `${changes} pile${changes > 1 ? 's' : ''} badlega${unit ? ' · kul farq' : ''}`}
      </span>
      {changes > 0 && (
        <span className="text-right">
          {unit && <span className={cn('text-lg font-bold tabular-nums', diffTone(baseDiff))}>{signedQty(baseDiff)} <span className="text-xs font-semibold">{unit}</span></span>}
          {valueDiff !== null && valueDiff !== 0 && (
            <span className={cn('block font-semibold text-fg-subtle', unit ? 'text-[11px]' : 'text-sm')}>Cost par <Money amount={valueDiff} tone="signed" /></span>
          )}
        </span>
      )}
    </div>
  );
}
