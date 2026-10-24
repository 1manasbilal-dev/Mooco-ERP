import React from 'react';
import { Banknote, Wallet, Check, Tag, Loader2, BookOpen, Clock, AlertCircle } from 'lucide-react';
import { SmartNumberInput } from '../SmartNumberInput';
import { formatCurrency } from '../../lib/formatters';
import { cn } from '../../lib/cn';
import { Kbd, Money } from '../ui';

interface PosPaymentPanelProps {
  cart: any[];
  paymentMode: string;
  setPaymentMode: (mode: string) => void;
  selectedCustomerId: string;
  customerPaidAmount: string;
  setCustomerPaidAmount: (amt: string) => void;
  customerDueAmount: number;
  customerChangeReturn: number;
  cashReceived: string;
  setCashReceived: (val: string) => void;
  cashGiven: number;
  discountType: 'flat' | 'percent';
  setDiscountType: (type: 'flat' | 'percent') => void;
  discountValue: string;
  setDiscountValue: (val: string) => void;
  subtotal: number;
  discountAmount: number;
  totalItemDiscount: number;
  grandTotal: number;
  isSubmitting: boolean;
  activeShiftSession: any;
  handleCheckout: () => void;
  /** What the customer still owes on this bill (total less a booking advance). Defaults to the grand total. */
  amountDue?: number;
  lockDiscount?: boolean;
  /** Opens the shift dialog; the pay button turns into "Start shift" while no shift is open. */
  onStartShift?: () => void;
  isDayLocked?: boolean;
}

const MODES = [
  { id: 'Cash', label: 'Cash', icon: Banknote },
  { id: 'Online', label: 'Online / Bank', short: 'Online', icon: Wallet },
  { id: 'Credit', label: 'Credit', icon: BookOpen },
] as const;

const TENDER_NOTES = [500, 1000, 2000, 5000];

/** Quick cash buttons: the exact bill plus the notes a customer is likely to hand over for it. */
const tenderOptions = (total: number): number[] => {
  const notes = TENDER_NOTES.filter(note => note > total);
  if (notes.length === 0 && total > 0) notes.push(Math.ceil(total / 1000) * 1000 + (total % 1000 === 0 ? 1000 : 0));
  return notes.slice(0, 3);
};

const moneyField = 'ds-control h-11 w-full rounded-control border border-line bg-surface px-3 text-right text-base font-bold tabular-nums text-fg shadow-e1 outline-none transition-[border-color,box-shadow] duration-150 placeholder:font-normal placeholder:text-fg-faint hover:border-line-strong focus:border-brand-accent focus:ring-4 focus:ring-ring/20 disabled:bg-surface-2 disabled:text-fg-subtle';

export const PosPaymentPanel: React.FC<PosPaymentPanelProps> = ({
  cart,
  paymentMode,
  setPaymentMode,
  selectedCustomerId,
  customerPaidAmount,
  setCustomerPaidAmount,
  customerDueAmount,
  customerChangeReturn,
  cashReceived,
  setCashReceived,
  cashGiven,
  discountType,
  setDiscountType,
  discountValue,
  setDiscountValue,
  subtotal,
  discountAmount,
  totalItemDiscount,
  grandTotal,
  isSubmitting,
  activeShiftSession,
  handleCheckout,
  amountDue,
  lockDiscount = false,
  onStartShift,
  isDayLocked = false
}) => {
  // "Full paid" fills what is still owed, so a booking advance is never handed back as change.
  const payableNow = amountDue ?? grandTotal;
  const noShift = !activeShiftSession || activeShiftSession.status !== 'Active';
  const hasItems = cart.length > 0;
  // A walk-in has no ledger to carry the unpaid part, so a short cash payment cannot be completed.
  const walkInShort = !selectedCustomerId && paymentMode === 'Cash' && cashGiven > 0 && cashGiven < grandTotal
    ? Math.round((grandTotal - cashGiven) * 100) / 100
    : 0;
  const walkInChange = !selectedCustomerId && paymentMode === 'Cash' && cashGiven >= grandTotal && cashGiven > 0
    ? Math.round((cashGiven - grandTotal) * 100) / 100
    : 0;
  const hasZeroQtyLine = cart.some(line => !(Number(line.qty) > 0));
  const canPay = hasItems && !isSubmitting && walkInShort === 0 && !noShift && !isDayLocked;
  const grossBeforeDiscounts = subtotal + totalItemDiscount;
  const modes = MODES.filter(mode => mode.id !== 'Credit' || selectedCustomerId);

  const chooseMode = (id: string) => {
    setPaymentMode(id);
    if (id === 'Credit') setCustomerPaidAmount('0');
    else if (customerPaidAmount === '0') setCustomerPaidAmount('');
  };

  const payLabel = isDayLocked
    ? 'Business day closed — sales blocked'
    : noShift
      ? 'Start Shift First — Sale Blocked'
      : selectedCustomerId && customerDueAmount > 0
        ? `Confirm & Post to Ledger (${paymentMode})`
        : `Confirm & Pay (${paymentMode})`;

  return (
    <div className="pos-payment-panel z-10 shrink-0 space-y-3 border-t border-line bg-surface p-3 shadow-[0_-8px_24px_-12px_rgb(15_23_42/0.18)]">
      {/* Payment mode */}
      <div role="radiogroup" aria-label="Payment mode" className={cn('grid gap-1 rounded-control bg-surface-2 p-1 ring-1 ring-inset ring-line/70', modes.length === 3 ? 'grid-cols-3' : 'grid-cols-2')}>
        {modes.map(mode => {
          const isSelected = paymentMode === mode.id;
          const Icon = mode.icon;
          return (
            <button
              key={mode.id}
              type="button"
              role="radio"
              aria-checked={isSelected}
              onClick={() => chooseMode(mode.id)}
              className={cn(
                'flex h-10 min-w-0 cursor-pointer items-center justify-center gap-1.5 rounded-[9px] px-2 text-[13px] font-semibold transition-colors duration-150',
                isSelected ? 'bg-surface text-fg shadow-e1' : 'text-fg-subtle hover:text-fg',
              )}
            >
              <Icon className={cn('size-4 shrink-0', isSelected ? (mode.id === 'Credit' ? 'text-warning-fg' : mode.id === 'Online' ? 'text-info-fg' : 'text-success-fg') : 'text-fg-faint')} aria-hidden="true" />
              <span className="truncate">
                {'short' in mode ? <><span className="sm:hidden">{mode.short}</span><span className="hidden sm:inline">{mode.label}</span></> : mode.label}
              </span>
            </button>
          );
        })}
      </div>

      {/* Money received */}
      {hasItems && selectedCustomerId && (
        <div className="space-y-2 rounded-control bg-surface-2/70 p-2.5 ring-1 ring-inset ring-line/70">
          <label className="flex items-center justify-between gap-3">
            <span className="flex shrink-0 items-center gap-1.5 text-xs font-semibold text-fg-muted">
              <Banknote className={cn('size-4', paymentMode === 'Credit' ? 'text-warning-fg' : 'text-success-fg')} aria-hidden="true" />
              {paymentMode === 'Credit' ? 'Paid now (optional)' : 'Amount paid now'}
            </span>
            <span className="relative w-full max-w-[190px]">
              <span className="pointer-events-none absolute left-3 top-1/2 z-[1] -translate-y-1/2 text-xs font-semibold text-fg-subtle">Rs</span>
              <SmartNumberInput
                step="any"
                placeholder={paymentMode === 'Credit' ? '0' : String(payableNow)}
                aria-label="Customer payment received"
                value={customerPaidAmount}
                onChange={setCustomerPaidAmount}
                className={cn(moneyField, 'pl-9')}
              />
            </span>
          </label>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2 text-xs">
            {customerDueAmount > 0 ? (
              <span className="flex items-center gap-1.5 font-semibold text-warning-fg">
                <span className="size-2 rounded-full bg-warning" aria-hidden="true" />
                On credit: <Money amount={customerDueAmount} className="font-bold" />
              </span>
            ) : customerChangeReturn > 0 ? (
              <span className="flex items-center gap-1.5 font-semibold text-success-fg">
                <span className="size-2 rounded-full bg-success" aria-hidden="true" />
                Change back: <Money amount={customerChangeReturn} className="font-bold" />
              </span>
            ) : (
              <span className="flex items-center gap-1 font-semibold text-success-fg">
                <Check className="size-3.5" aria-hidden="true" /> Fully paid (Rs 0 on credit)
              </span>
            )}
            <span className="flex items-center gap-1.5">
              <ChipButton tone="warning" title="Zero payment received - add the full bill to the ledger" onClick={() => { setPaymentMode('Credit'); setCustomerPaidAmount('0'); }}>
                Full credit
              </ChipButton>
              <ChipButton tone="success" title="Full payment received" onClick={() => { if (paymentMode === 'Credit') setPaymentMode('Cash'); setCustomerPaidAmount(String(payableNow)); }}>
                Full paid · {formatCurrency(payableNow)}
              </ChipButton>
            </span>
          </div>
        </div>
      )}

      {hasItems && !selectedCustomerId && paymentMode === 'Cash' && (
        <div className="space-y-2 rounded-control bg-surface-2/70 p-2.5 ring-1 ring-inset ring-line/70">
          <label className="flex items-center justify-between gap-3">
            <span className="shrink-0 text-xs font-semibold text-fg-muted">Cash received</span>
            <span className="relative w-full max-w-[190px]">
              <span className="pointer-events-none absolute left-3 top-1/2 z-[1] -translate-y-1/2 text-xs font-semibold text-fg-subtle">Rs</span>
              <SmartNumberInput
                placeholder="0"
                aria-label="Cash received"
                value={cashReceived}
                onChange={setCashReceived}
                className={cn(moneyField, 'pl-9')}
              />
            </span>
          </label>
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 gap-1.5 overflow-x-auto scrollbar-hide">
              <ChipButton onClick={() => setCashReceived(String(grandTotal))}>Exact</ChipButton>
              {tenderOptions(grandTotal).map(note => (
                <ChipButton key={note} onClick={() => setCashReceived(String(note))}>{note.toLocaleString('en-PK')}</ChipButton>
              ))}
            </div>
            {cashGiven > 0 && (
              <span
                role="status"
                className={cn(
                  'inline-flex h-8 shrink-0 items-center gap-1 rounded-full px-2.5 text-xs font-bold tabular-nums ring-1 ring-inset',
                  walkInShort > 0 ? 'bg-danger-soft text-danger-fg ring-danger/20' : 'bg-success-soft text-success-fg ring-success/20',
                )}
              >
                {walkInShort > 0 ? 'Short' : 'Change'} <Money amount={walkInShort > 0 ? walkInShort : walkInChange} />
              </span>
            )}
          </div>
        </div>
      )}

      {/* Totals */}
      <div className="space-y-1.5 px-0.5">
        {hasItems && (
          <div className="flex items-center justify-between gap-3 text-xs">
            <span className="flex items-center gap-1.5 font-semibold text-fg-muted"><Tag className="size-3.5" aria-hidden="true" /> Discount</span>
            <span className="flex items-center gap-1">
              <button
                type="button"
                disabled={lockDiscount}
                onClick={() => setDiscountType(discountType === 'flat' ? 'percent' : 'flat')}
                aria-label={`Discount type: ${discountType === 'flat' ? 'rupees' : 'percent'}. Click to switch.`}
                title="Toggle Rs / % Discount"
                className="h-9 min-w-10 cursor-pointer rounded-lg bg-surface-2 px-2 text-xs font-bold text-fg-muted ring-1 ring-inset ring-line transition-colors hover:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {discountType === 'flat' ? 'Rs' : '%'}
              </button>
              <SmartNumberInput
                placeholder="0"
                aria-label="Sale discount"
                value={discountValue}
                disabled={lockDiscount}
                onChange={setDiscountValue}
                wrapperClassName="w-24"
                className={cn(moneyField, 'h-9 text-sm')}
              />
            </span>
          </div>
        )}
        {totalItemDiscount > 0 && (
          <div className="flex items-center justify-between text-xs font-semibold text-success-fg">
            <span className="flex items-center gap-1.5"><Tag className="size-3.5" aria-hidden="true" /> Item discounts</span>
            <span className="tabular-nums">-{formatCurrency(totalItemDiscount)}</span>
          </div>
        )}
        {discountAmount > 0 && (
          <div className="flex items-center justify-between text-xs font-semibold text-success-fg">
            <span>Bill discount</span>
            <span className="tabular-nums">-{formatCurrency(discountAmount)}</span>
          </div>
        )}
        <div className="flex items-end justify-between gap-3 border-t border-line pt-2">
          <div>
            <span className="block text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">Grand total</span>
            {(discountAmount > 0 || totalItemDiscount > 0) && (
              <span className="text-xs tabular-nums text-fg-faint line-through">{formatCurrency(grossBeforeDiscounts)}</span>
            )}
          </div>
          <Money amount={grandTotal} className="text-[28px] font-bold leading-none tracking-tight text-fg" />
        </div>
      </div>

      {/* A blank or 0 qty line blocks checkout; handleCheckout shows the same message as a toast. */}
      {hasZeroQtyLine && (
        <p role="status" className="flex items-center gap-1.5 rounded-lg bg-warning-soft px-2.5 py-1.5 text-xs font-semibold text-warning-fg">
          <AlertCircle className="size-3.5 shrink-0" aria-hidden="true" /> Remove the qty 0 line or enter a qty
        </p>
      )}
      {walkInShort > 0 && (
        <p role="status" className="flex items-start gap-1.5 rounded-lg bg-danger-soft px-2.5 py-1.5 text-xs font-semibold text-danger-fg">
          <AlertCircle className="mt-px size-3.5 shrink-0" aria-hidden="true" />
          <span>{formatCurrency(walkInShort)} short. Take the full amount, or select a customer so the rest goes on their ledger.</span>
        </p>
      )}

      {/* With no open shift it starts one instead of sitting disabled. */}
      {noShift && onStartShift && !isDayLocked ? (
        <button
          type="button"
          onClick={onStartShift}
          className="flex h-14 w-full cursor-pointer items-center justify-center gap-2 rounded-control bg-warning text-[15px] font-bold text-white shadow-e1 transition-[background-color,transform] duration-150 hover:bg-warning/90 active:scale-[.99]"
        >
          <Clock className="size-5" aria-hidden="true" />
          Start shift to sell
        </button>
      ) : (
        <button
          type="button"
          aria-label="Complete sale"
          onClick={handleCheckout}
          disabled={!canPay}
          aria-busy={isSubmitting || undefined}
          className={cn(
            'flex h-14 w-full items-center justify-between gap-3 rounded-control px-4 text-left font-bold transition-[background-color,transform,box-shadow] duration-150',
            canPay
              ? 'cursor-pointer bg-brand text-brand-on shadow-e1-lit hover:bg-brand-hover active:scale-[.99]'
              : 'cursor-not-allowed bg-surface-3 text-fg-subtle',
          )}
        >
          {isSubmitting ? (
            <span className="flex w-full items-center justify-center gap-2 text-[15px]">
              <Loader2 className="size-5 animate-spin" aria-hidden="true" /> Saving sale...
            </span>
          ) : (
            <>
              <span className="flex min-w-0 items-center gap-2 text-[14px]">
                {paymentMode === 'Online' ? <Wallet className="size-5 shrink-0" aria-hidden="true" /> : paymentMode === 'Credit' ? <BookOpen className="size-5 shrink-0" aria-hidden="true" /> : <Banknote className="size-5 shrink-0" aria-hidden="true" />}
                <span className="truncate">{payLabel}</span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                {hasItems && !noShift && !isDayLocked && <Money amount={grandTotal} className="text-[17px]" />}
                <Kbd className={cn('hidden md:inline-flex', canPay && 'bg-brand-on/15 text-brand-on ring-brand-on/25')}>F9</Kbd>
              </span>
            </>
          )}
        </button>
      )}
    </div>
  );
};

function ChipButton({ tone = 'neutral', className, ...props }: React.ComponentProps<'button'> & { tone?: 'neutral' | 'success' | 'warning' }) {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex h-8 shrink-0 cursor-pointer items-center whitespace-nowrap rounded-full px-3 text-xs font-semibold tabular-nums ring-1 ring-inset transition-colors duration-150',
        tone === 'success' && 'bg-success-soft text-success-fg ring-success/20 hover:bg-success/15',
        tone === 'warning' && 'bg-warning-soft text-warning-fg ring-warning/25 hover:bg-warning/15',
        tone === 'neutral' && 'bg-surface text-fg-muted ring-line hover:bg-surface-3 hover:text-fg',
        className,
      )}
      {...props}
    />
  );
}
