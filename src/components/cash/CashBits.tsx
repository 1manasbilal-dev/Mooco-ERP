import React from 'react';
import { AlertTriangle, Banknote, CheckCircle2, TrendingDown, TrendingUp } from 'lucide-react';
import { Badge, IconButton, Money, controlClass } from '../ui';
import type { Tone } from '../ui';
import { cn } from '../../lib/cn';
import { formatCurrency } from '../../lib/formatters';
import { SHIFT_STATUS_TONE, initials } from './cashFormat';
import { denominationEntries, type DenominationCounts } from './denominations';

/** Initials chip for a cashier or head. */
export const Avatar: React.FC<{ name?: string | null; tone?: 'brand' | 'info' | 'neutral'; size?: 'sm' | 'md' }> = ({ name, tone = 'neutral', size = 'md' }) => (
  <span
    aria-hidden="true"
    className={cn(
      'flex shrink-0 items-center justify-center rounded-xl font-bold',
      size === 'sm' ? 'size-8 text-[11px]' : 'size-10 text-xs',
      tone === 'brand' ? 'bg-brand-soft text-brand-fg' : tone === 'info' ? 'bg-info-soft text-info-fg' : 'bg-surface-2 text-fg-muted ring-1 ring-inset ring-line',
    )}
  >
    {initials(name)}
  </span>
);

export const ShiftStatusBadge: React.FC<{ status: string }> = ({ status }) => (
  <Badge tone={SHIFT_STATUS_TONE[status] || 'neutral'} dot>{status}</Badge>
);

/** "2 × Rs 5,000" chips for a non-zero denomination breakdown. */
export const DenominationChips: React.FC<{ value: DenominationCounts | null | undefined }> = ({ value }) => {
  const entries = denominationEntries(value);
  if (entries.length === 0) return <span className="text-xs italic text-fg-subtle">Not itemized</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {entries.map(([denomination, count]) => (
        <span key={denomination} className="inline-flex h-6 items-center rounded-md bg-surface px-2 text-[11px] font-semibold tabular-nums text-fg-muted ring-1 ring-inset ring-line">
          {count} × {formatCurrency(denomination)}
        </span>
      ))}
    </div>
  );
};

/** Label over value, for detail grids. */
export const Detail: React.FC<{ label: React.ReactNode; children: React.ReactNode; className?: string }> = ({ label, children, className }) => (
  <div className={cn('min-w-0', className)}>
    <p className="text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">{label}</p>
    <div className="mt-0.5 break-words text-[13px] font-semibold text-fg-muted">{children}</div>
  </div>
);

/**
 * Counted vs expected, in words. Over and short are both recorded as a variance, so the text says so;
 * colour follows the cash: over = success, short = danger.
 */
export const VarianceCallout: React.FC<{
  variance: number | null;
  /** What the count was compared against, e.g. "declared" or "expected". */
  against?: string;
  /** Extra sentence after over/short, e.g. "a variance will be recorded". */
  consequence?: string;
  className?: string;
}> = ({ variance, against = 'expected', consequence = 'a variance will be recorded.', className }) => {
  if (variance === null) return null;
  const tone = variance === 0 ? 'exact' : variance > 0 ? 'over' : 'short';
  const Icon = tone === 'exact' ? CheckCircle2 : tone === 'over' ? TrendingUp : TrendingDown;
  return (
    <div
      role="status"
      className={cn(
        'flex items-start gap-2 rounded-control px-3 py-2.5 text-[13px] font-semibold ring-1 ring-inset',
        tone === 'short' ? 'bg-danger-soft text-danger-fg ring-danger/20' : 'bg-success-soft text-success-fg ring-success/20',
        className,
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span>
        {tone === 'exact' && <>Exact — counted cash matches the {against} amount.</>}
        {tone !== 'exact' && (
          <>
            {tone === 'over' ? 'Over' : 'Short'} by <Money amount={Math.abs(variance)} className="font-bold" /> vs {against} — {consequence}
          </>
        )}
      </span>
    </div>
  );
};

/** Big rupee field with a note-count button inside it. */
export const CountInput: React.FC<{
  id?: string;
  value: string;
  onChange: (value: string) => void;
  onCount: () => void;
  /** Total of the counted notes, shown under the field when non-zero. */
  denominationTotal?: number;
  denominationPieces?: number;
  placeholder?: string;
  invalid?: boolean;
  disabled?: boolean;
  'aria-describedby'?: string;
  inputRef?: React.Ref<HTMLInputElement>;
  onKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  countLabel?: string;
}> = ({
  id, value, onChange, onCount, denominationTotal = 0, denominationPieces = 0, placeholder = '0', invalid, disabled, inputRef, onKeyDown,
  countLabel = 'Note count — count each note', ...aria
}) => (
  <div>
    <div className="relative">
      <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-semibold text-fg-subtle">Rs</span>
      <input
        id={id}
        ref={inputRef}
        type="number"
        inputMode="decimal"
        min="0"
        step="any"
        value={value}
        disabled={disabled}
        onChange={event => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        onWheel={event => (event.currentTarget as HTMLInputElement).blur()}
        placeholder={placeholder}
        aria-invalid={invalid || undefined}
        aria-describedby={aria['aria-describedby']}
        className={cn(controlClass, 'h-12 pl-10 pr-14 text-lg font-bold tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none')}
      />
      <IconButton
        aria-label={countLabel}
        icon={<Banknote />}
        size="sm"
        variant={denominationTotal > 0 ? 'soft' : 'ghost'}
        disabled={disabled}
        onClick={onCount}
        className="absolute right-2 top-1/2 -translate-y-1/2"
      />
    </div>
    {denominationTotal > 0 && (
      <p className="mt-1.5 flex items-center gap-1.5 text-xs font-semibold text-brand-fg">
        <Banknote className="size-3.5" aria-hidden="true" />
        Note count: <Money amount={denominationTotal} /> · {denominationPieces} {denominationPieces === 1 ? 'piece' : 'pieces'}
      </p>
    )}
  </div>
);

/** One line of a readiness checklist. */
export const CheckItem: React.FC<{ ok: boolean; label: React.ReactNode; count?: number; hint?: React.ReactNode }> = ({ ok, label, count, hint }) => (
  <div className="flex items-start gap-2.5">
    {ok
      ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
      : <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />}
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={cn('text-[13px] font-semibold', ok ? 'text-fg-subtle' : 'text-fg')}>{label}</span>
        {!ok && Number(count) > 0 && <Badge tone="warning">{count} pending</Badge>}
      </div>
      {!ok && hint && <p className="mt-0.5 text-xs text-fg-subtle">{hint}</p>}
    </div>
  </div>
);

/** Small label/value tile used in day summaries. */
export const MiniStat: React.FC<{ label: React.ReactNode; children: React.ReactNode; tone?: Tone; className?: string }> = ({ label, children, tone, className }) => (
  <div
    className={cn(
      'min-w-0 rounded-control px-3 py-2 ring-1 ring-inset',
      tone === 'danger' ? 'bg-danger-soft/60 ring-danger/20' : tone === 'success' ? 'bg-success-soft/60 ring-success/20' : 'bg-surface-2 ring-line/70',
      className,
    )}
  >
    <p className="truncate text-[11px] font-semibold text-fg-subtle">{label}</p>
    <div className="mt-0.5 truncate text-sm font-bold tabular-nums text-fg">{children}</div>
  </div>
);
