import React, { useRef } from 'react';
import { Banknote, Check, Minus, Plus, RotateCcw } from 'lucide-react';
import { Button, Kbd, Modal, Money } from './ui';
import { cn } from '../lib/cn';
import { formatCurrency } from '../lib/formatters';
import { DENOMINATIONS, denominationPieces, denominationTotal, pieceCount, splitDenominations, type DenominationCounts } from './cash/denominations';
import { cashVariance } from './cash/cashFormat';

// Kept here for existing importers (POS shift modal, shift activity dialog).
export { DENOMINATIONS, splitDenominations };

export const money = (value: number | undefined | null) =>
  formatCurrency(value);

export interface DenominationDialogProps {
  open: boolean;
  onClose: () => void;
  value: DenominationCounts;
  onChange: (next: DenominationCounts) => void;
  onApply: (total: number) => void;
  title?: string;
  subtitle?: string;
  /** Optional amount to count against (declared / expected); shows the live difference. */
  expectedAmount?: number;
  expectedLabel?: string;
}

const MAX_PIECES = 99999;

/**
 * Cash count by note and coin. Built for speed at the counter: type a count and press Enter to
 * jump to the next note, arrow keys move up and down, + / − change the count, Ctrl+Enter applies.
 */
export const DenominationDialog: React.FC<DenominationDialogProps> = props => (props.open ? <DenominationCounter {...props} /> : null);

const DenominationCounter: React.FC<DenominationDialogProps> = ({
  onClose,
  value,
  onChange,
  onApply,
  title = 'Cash Denomination Count',
  subtitle = 'Har note aur sikkay ki taadaad likhein',
  expectedAmount,
  expectedLabel = 'Expected',
}) => {
  const inputs = useRef<Array<HTMLInputElement | null>>([]);
  const firstInputRef = useRef<HTMLInputElement | null>(null);
  const total = denominationTotal(value);
  const pieces = denominationPieces(value);
  const hasExpected = typeof expectedAmount === 'number' && Number.isFinite(expectedAmount);
  const difference = hasExpected && pieces > 0 ? cashVariance(total, Number(expectedAmount)) : null;
  const last = DENOMINATIONS.length - 1;

  const setCount = (denomination: number, count: number) => {
    const next = { ...value };
    const safe = Math.min(MAX_PIECES, pieceCount(count));
    if (safe > 0) next[denomination] = safe;
    else delete next[denomination];
    onChange(next);
  };

  const focusAt = (index: number) => {
    const input = inputs.current[Math.max(0, Math.min(last, index))];
    if (input) { input.focus(); input.select(); }
  };

  const apply = () => {
    onApply(total);
    onClose();
  };

  const handleKeyDown = (index: number, denomination: number) => (event: React.KeyboardEvent<HTMLInputElement>) => {
    const count = pieceCount(value[denomination]);
    switch (event.key) {
      case 'Enter':
        event.preventDefault();
        if (event.ctrlKey || event.metaKey || index === last) apply();
        else focusAt(index + 1);
        break;
      case 'ArrowDown':
        event.preventDefault();
        focusAt(index + 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        focusAt(index - 1);
        break;
      case '+':
      case '=':
        event.preventDefault();
        setCount(denomination, count + 1);
        break;
      case '-':
        event.preventDefault();
        setCount(denomination, count - 1);
        break;
      default:
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="md"
      title={title}
      description={subtitle}
      initialFocusRef={firstInputRef}
      icon={<span className="flex size-10 items-center justify-center rounded-xl bg-brand-soft text-brand-fg"><Banknote size={20} /></span>}
      footer={(
        <>
          <Button variant="ghost" leftIcon={<RotateCcw />} disabled={pieces === 0} onClick={() => { onChange({}); focusAt(0); }} className="sm:mr-auto">
            Clear
          </Button>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button leftIcon={<Check />} onClick={apply}>
            Apply <Money amount={total} />
          </Button>
        </>
      )}
    >
      <div className="sticky top-0 z-10 -mx-5 -mt-4 border-b border-line bg-surface px-5 pb-3 pt-4">
        <div className="flex items-end justify-between gap-3 rounded-card bg-surface-2 px-4 py-3 ring-1 ring-inset ring-line/70">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">Total count</p>
            <p className="mt-0.5 truncate text-2xl font-bold tracking-tight tabular-nums text-fg sm:text-[28px]" aria-live="polite">
              <Money amount={total} />
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-[11px] font-semibold text-fg-subtle">{pieces} {pieces === 1 ? 'piece' : 'pieces'}</p>
            {hasExpected && (
              <p className="mt-0.5 text-xs font-semibold text-fg-subtle">
                {expectedLabel} <Money amount={expectedAmount} className="text-fg-muted" />
              </p>
            )}
            {difference !== null && (
              <p className={cn('mt-0.5 text-xs font-bold', difference === 0 ? 'text-success-fg' : difference > 0 ? 'text-success-fg' : 'text-danger-fg')}>
                {difference === 0 ? 'Exact match' : <>{difference > 0 ? 'Over' : 'Short'} <Money amount={Math.abs(difference)} /></>}
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="pt-1">
        {DENOMINATIONS.map((denomination, index) => {
          const count = pieceCount(value[denomination]);
          const inputId = `denomination-${denomination}`;
          return (
            <div key={denomination} className="flex items-center gap-2 border-b border-line/70 py-1.5">
              <label htmlFor={inputId} className={cn('w-16 shrink-0 text-[13px] font-bold tabular-nums', count > 0 ? 'text-fg' : 'text-fg-muted')}>
                {denomination.toLocaleString('en-PK')}
              </label>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label={`Rs ${denomination} ek kam`}
                  disabled={count === 0}
                  onClick={() => setCount(denomination, count - 1)}
                  className="flex size-8 cursor-pointer items-center justify-center rounded-lg text-fg-subtle hover:bg-surface-2 hover:text-fg disabled:pointer-events-none disabled:opacity-30"
                >
                  <Minus className="size-3.5" />
                </button>
                <input
                  id={inputId}
                  ref={element => {
                    inputs.current[index] = element;
                    if (index === 0) firstInputRef.current = element;
                  }}
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  value={count > 0 ? String(count) : ''}
                  placeholder="0"
                  onChange={event => setCount(denomination, Number(event.target.value.replace(/\D/g, '') || 0))}
                  onKeyDown={handleKeyDown(index, denomination)}
                  onFocus={event => event.currentTarget.select()}
                  className={cn(
                    'ds-control h-9 w-16 rounded-lg border bg-surface text-center text-sm font-bold tabular-nums text-fg outline-none transition-[border-color,box-shadow] duration-150 placeholder:font-normal placeholder:text-fg-faint focus:border-brand-accent focus:ring-4 focus:ring-ring/20',
                    count > 0 ? 'border-brand-accent/60' : 'border-line',
                  )}
                />
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label={`Rs ${denomination} ek zyada`}
                  onClick={() => setCount(denomination, count + 1)}
                  className="flex size-8 cursor-pointer items-center justify-center rounded-lg text-fg-subtle hover:bg-surface-2 hover:text-fg"
                >
                  <Plus className="size-3.5" />
                </button>
              </div>
              <span className={cn('ml-auto truncate text-right text-[13px] font-semibold tabular-nums', count > 0 ? 'text-fg' : 'text-fg-faint')}>
                {count > 0 ? <Money amount={denomination * count} /> : '—'}
              </span>
            </div>
          );
        })}
      </div>

      <p className="mt-3 hidden flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-fg-subtle sm:flex">
        <span><Kbd>Enter</Kbd> agla note</span>
        <span><Kbd>↑</Kbd> <Kbd>↓</Kbd> upar / neeche</span>
        <span><Kbd>+</Kbd> <Kbd>−</Kbd> ek zyada / kam</span>
        <span><Kbd>Ctrl</Kbd>+<Kbd>Enter</Kbd> apply</span>
      </p>
    </Modal>
  );
};
