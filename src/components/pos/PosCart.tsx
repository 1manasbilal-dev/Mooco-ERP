import React, { memo } from 'react';
import { ShoppingCart, Trash2, ChevronLeft, Minus, Plus, Maximize2, ChevronDown } from 'lucide-react';
import { motion } from 'framer-motion';
import { formatCurrency, formatQty } from '../../lib/formatters';
import { cn } from '../../lib/cn';
import { confirmAction } from '../ui/ConfirmDialog';
import { Button, EmptyState, IconButton } from '../ui';

const MotionDiv = motion.div as any;

/** "~500 ml" for part-litre lines, so the cashier can read 0.5 L at a glance. */
const friendlyVolume = (item: any): string | null => {
  const unit = item.unit || item.baseUnit || '';
  if (!(item.qty > 0 && item.qty < 1)) return null;
  if (/liter|litre|\bl\b/i.test(unit)) return `~${Math.round(item.qty * 1000)} ml`;
  if (/kg|kilo/i.test(unit)) return `~${Math.round(item.qty * 1000)} g`;
  return null;
};

const lineSaving = (item: any) => {
  const hasDiscount = item.originalPrice !== undefined && item.originalPrice > item.price;
  return {
    perUnit: hasDiscount ? item.originalPrice - item.price : 0,
    total: hasDiscount ? (item.originalPrice - item.price) * item.qty : 0,
  };
};

/** A focused number field must not change when the mouse wheel scrolls the cart. */
const blurOnWheel = (event: React.WheelEvent<HTMLInputElement>) => event.currentTarget.blur();

export interface PosCartLineActions {
  updateQty: (cartItemId: string, delta: number) => void;
  setDirectQty: (cartItemId: string, val: string) => void;
  updateRate: (cartItemId: string, val: string) => void;
  updateLineTotal: (cartItemId: string, val: string) => void;
  openEditItemModal: (item: any) => void;
  removeLine: (cartItemId: string) => void;
}

interface PosCartProps extends PosCartLineActions {
  expanded: boolean;
  cart: any[];
  setMobileTab: (tab: 'catalog' | 'cart') => void;
  getLineTotal: (item: any) => number;
  onClearCart: () => void;
  /** Swipe-to-delete on phones also tells the cashier what went. */
  onSwipeRemove: (item: any) => void;
  /** Cart edits are paused while a sale is being saved. */
  locked?: boolean;
}

export const PosCart = memo(function PosCart({
  expanded,
  cart,
  setMobileTab,
  getLineTotal,
  onClearCart,
  onSwipeRemove,
  locked = false,
  ...actions
}: PosCartProps) {
  const clearCartWithConfirm = async () => {
    const ok = await confirmAction({
      tone: 'warning',
      title: 'Cart khali karein?',
      consequences: [`Cart ke ${cart.length} item(s) hat jayenge.`, 'Abhi tak bill save nahi hua, is liye stock ya khaate par asar nahi hoga.'],
      confirmLabel: 'Haan, khali karein',
    });
    if (ok) onClearCart();
  };
  const itemCount = cart.length;

  return (
    <>
      <div className="z-10 shrink-0 border-b border-line bg-surface">
        {/* Phones and tablets: back to products, title, clear. */}
        <div className="flex items-center justify-between gap-2 px-2.5 py-2 lg:hidden">
          <Button variant="secondary" size="md" leftIcon={<ChevronLeft />} onClick={() => setMobileTab('catalog')}>
            Products
          </Button>
          <span className="flex items-center gap-1.5 text-sm font-bold text-fg">
            <ShoppingCart className="size-4 text-brand-fg" aria-hidden="true" />
            Review cart
            {itemCount > 0 && <CountBubble count={itemCount} />}
          </span>
          {itemCount > 0 ? (
            <Button variant="danger-soft" size="md" disabled={locked} onClick={clearCartWithConfirm}>Clear</Button>
          ) : <span className="w-[88px]" aria-hidden="true" />}
        </div>

        <div className="hidden items-center justify-between gap-2 px-3 py-1.5 lg:flex">
          <Button
            variant="ghost"
            size="sm"
            className="text-brand-fg hover:text-brand-fg"
            leftIcon={expanded ? <ChevronLeft /> : <Maximize2 />}
            onClick={() => setMobileTab(expanded ? 'catalog' : 'cart')}
          >
            {expanded ? 'Products' : 'Expand cart'}
          </Button>
          <span className="flex items-center gap-1.5 text-[13px] font-bold text-fg">
            <ShoppingCart className="size-4 text-brand-fg" aria-hidden="true" />
            Current cart
            <span className="rounded-full bg-surface-2 px-2 text-[11px] font-semibold tabular-nums leading-5 text-fg-muted ring-1 ring-inset ring-line">
              {itemCount} item{itemCount !== 1 ? 's' : ''}
            </span>
          </span>
          {itemCount > 0 ? (
            <Button variant="ghost" size="sm" className="hover:bg-danger-soft hover:text-danger-fg" leftIcon={<Trash2 />} disabled={locked} onClick={clearCartWithConfirm}>
              Clear
            </Button>
          ) : <span className="w-16" aria-hidden="true" />}
        </div>
      </div>

      <div className="pos-cart-list min-h-0 flex-1 overflow-y-auto bg-surface" aria-busy={locked || undefined}>
        {itemCount === 0 ? (
          <EmptyState
            className="h-full"
            icon={<ShoppingCart />}
            title="Cart khali hai"
            description="Catalog se koi product tap karein, ya F2 se search karein."
          />
        ) : (
          <>
            {/* Phones: one row per line with name, quantity and total; swipe sideways to remove. */}
            <div className="md:hidden">
              <div className="pos-mobile-cart-columns grid grid-cols-[minmax(0,1fr)_112px_92px] gap-2 border-b border-line bg-surface-2 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">
                <span>Item</span>
                <span className="text-center">Qty</span>
                <span className="text-right">Total</span>
              </div>
              <div className="divide-y divide-line">
                {cart.map(item => (
                  <MobileCartRow key={item.cartItemId} item={item} lineTotal={getLineTotal(item)} onSwipeRemove={onSwipeRemove} locked={locked} {...actions} />
                ))}
              </div>
            </div>

            <table className="hidden w-full border-collapse text-left md:table">
              <thead className="sticky top-0 z-[1] bg-surface-2">
                <tr className="border-b border-line text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">
                  <th scope="col" className="h-9 px-3">Item &amp; unit</th>
                  <th scope="col" className="h-9 w-24 px-2 text-right">Rate</th>
                  <th scope="col" className="h-9 w-[136px] px-2 text-center">Qty</th>
                  <th scope="col" className="h-9 w-28 px-3 text-right">Total</th>
                  <th scope="col" className="h-9 w-10 px-1"><span className="sr-only">Remove</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {cart.map(item => (
                  <DesktopCartRow key={item.cartItemId} item={item} lineTotal={getLineTotal(item)} locked={locked} {...actions} />
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </>
  );
});

function CountBubble({ count }: { count: number }) {
  return <span className="rounded-full bg-brand-soft px-1.5 text-[11px] font-bold tabular-nums leading-5 text-brand-fg">{count}</span>;
}

/** Variant / unit caption, custom-amount and part-litre hints under the line name. */
function LineMeta({ item, compact }: { item: any; compact?: boolean }) {
  const volume = friendlyVolume(item);
  const unitCaption = item.variantName
    ? `${item.variantName}${compact ? '' : ` (${formatQty(item.stockDeduction, 3)} ${item.baseUnit || 'pcs'})`}`
    : item.unit;
  return (
    <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-fg-subtle">
      <span className="truncate">{unitCaption}</span>
      <span aria-hidden="true" className="text-fg-faint">·</span>
      <span className="tabular-nums">{formatCurrency(item.price)}</span>
      {volume && <span className="rounded bg-brand-soft px-1.5 text-[11px] font-semibold leading-[18px] text-brand-fg">{volume}</span>}
      {item.customTotal !== undefined && item.customTotal !== null && (
        <span className="rounded bg-warning-soft px-1.5 text-[11px] font-semibold leading-[18px] text-warning-fg" title="Line total typed by hand">
          {formatCurrency(item.customTotal)} {compact ? 'custom' : 'custom amount'}
        </span>
      )}
    </span>
  );
}

interface RowProps extends PosCartLineActions {
  item: any;
  lineTotal: number;
  locked: boolean;
}

function QtyStepper({ item, size, locked, updateQty, setDirectQty }: { item: any; size: 'sm' | 'md'; locked: boolean } & Pick<PosCartLineActions, 'updateQty' | 'setDirectQty'>) {
  const button = cn(
    'flex shrink-0 cursor-pointer items-center justify-center rounded-lg text-fg-muted transition-colors hover:bg-surface hover:text-fg active:scale-95 disabled:pointer-events-none disabled:opacity-40',
    size === 'md' ? 'size-9' : 'size-8',
  );
  return (
    <div className="flex items-center rounded-control bg-surface-2 p-0.5 ring-1 ring-inset ring-line">
      <button type="button" aria-label={`Decrease ${item.name}`} title="Decrease" disabled={locked} onClick={() => updateQty(item.cartItemId, -1)} className={button}>
        <Minus className="size-3.5" />
      </button>
      <input
        type="number"
        inputMode="decimal"
        aria-label={`${item.name} quantity`}
        step="any"
        value={item.qty}
        disabled={locked}
        onChange={e => setDirectQty(item.cartItemId, e.target.value)}
        onWheel={blurOnWheel}
        onFocus={e => e.currentTarget.select()}
        className={cn('ds-control min-w-0 bg-transparent text-center text-sm font-bold tabular-nums text-fg outline-none', size === 'md' ? 'w-10' : 'w-11')}
      />
      <button type="button" aria-label={`Increase ${item.name}`} title="Increase" disabled={locked} onClick={() => updateQty(item.cartItemId, 1)} className={button}>
        <Plus className="size-3.5" />
      </button>
    </div>
  );
}

const amountInput = 'ds-control min-w-0 rounded-lg border border-transparent bg-transparent px-1.5 py-1 text-right tabular-nums text-fg outline-none transition-colors hover:border-line focus:border-brand-accent focus:bg-surface focus:ring-2 focus:ring-ring/20';

const DesktopCartRow = memo(function DesktopCartRow({ item, lineTotal, locked, updateQty, setDirectQty, updateRate, updateLineTotal, openEditItemModal, removeLine }: RowProps) {
  const saving = lineSaving(item);
  return (
    <tr className="group transition-colors hover:bg-surface-2/60">
      <td className="min-w-0 px-3 py-2.5">
        <button
          type="button"
          aria-label={`Edit ${item.name}`}
          disabled={locked}
          onClick={() => openEditItemModal(item)}
          className="block cursor-pointer text-left text-sm font-semibold leading-snug text-fg transition-colors hover:text-brand-fg"
        >
          {item.name}
        </button>
        <LineMeta item={item} />
      </td>

      <td className="whitespace-nowrap px-2 py-2.5 text-right">
        <label className="flex items-center justify-end gap-0.5">
          <span className="text-xs text-fg-faint">Rs</span>
          <input
            type="number"
            inputMode="decimal"
            aria-label={`${item.name} rate`}
            title="Click to edit unit rate"
            step="any"
            value={item.price}
            disabled={locked}
            onChange={e => updateRate(item.cartItemId, e.target.value)}
            onWheel={blurOnWheel}
            className={cn(amountInput, 'w-16 text-[13px] font-semibold')}
          />
        </label>
        {saving.perUnit > 0 && (
          <span className="mt-0.5 block text-[11px] font-semibold tabular-nums text-success-fg" title="Discount per unit">
            -{formatCurrency(saving.perUnit)}
          </span>
        )}
      </td>

      <td className="whitespace-nowrap px-2 py-2.5">
        <div className="flex items-center justify-center gap-1.5">
          <QtyStepper item={item} size="sm" locked={locked} updateQty={updateQty} setDirectQty={setDirectQty} />
          <button
            type="button"
            disabled={locked}
            onClick={() => openEditItemModal(item)}
            title="Unit aur quantity chunein"
            className="flex h-8 max-w-[84px] cursor-pointer items-center gap-0.5 rounded-lg bg-brand-soft px-2 text-[11px] font-bold text-brand-fg transition-colors hover:bg-brand/15"
          >
            <span className="truncate">{item.unit}</span>
            <ChevronDown className="size-3 shrink-0 opacity-70" aria-hidden="true" />
          </button>
        </div>
      </td>

      <td className="whitespace-nowrap px-3 py-2.5 text-right">
        <label className="flex items-center justify-end gap-0.5">
          <span className="text-xs text-fg-faint">Rs</span>
          <input
            type="number"
            inputMode="decimal"
            aria-label={`${item.name} line total`}
            title="Total likhein, quantity khud ban jayegi"
            step="any"
            value={item.customTotal !== undefined ? item.customTotal : (item.qty === 0 ? '' : lineTotal)}
            placeholder="0"
            disabled={locked}
            onChange={e => updateLineTotal(item.cartItemId, e.target.value)}
            onWheel={blurOnWheel}
            className={cn(amountInput, 'w-20 text-sm font-bold')}
          />
        </label>
        {saving.total > 0 && (
          <span className="mt-0.5 block text-[11px] font-semibold tabular-nums text-success-fg" title="Total line savings">
            Save {formatCurrency(saving.total)}
          </span>
        )}
      </td>

      <td className="px-1 py-2.5 text-center">
        <IconButton
          size="sm"
          aria-label={`Remove ${item.name}`}
          title="Remove item"
          disabled={locked}
          icon={<Trash2 />}
          onClick={() => removeLine(item.cartItemId)}
          className="text-fg-faint hover:bg-danger-soft hover:text-danger-fg"
        />
      </td>
    </tr>
  );
});

const MobileCartRow = memo(function MobileCartRow({ item, lineTotal, locked, updateQty, setDirectQty, updateLineTotal, openEditItemModal, onSwipeRemove }: RowProps & { onSwipeRemove: (item: any) => void }) {
  const saving = lineSaving(item);
  return (
    <div className="relative overflow-hidden">
      <div className="absolute inset-x-0 inset-y-px flex items-center justify-between bg-danger px-4 text-xs font-bold text-white" aria-hidden="true">
        <span className="flex items-center gap-1.5"><Trash2 className="size-4" /> Delete</span>
        <span className="flex items-center gap-1.5">Delete <Trash2 className="size-4" /></span>
      </div>

      <MotionDiv
        drag={locked ? false : 'x'}
        dragDirectionLock
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.6}
        onDragEnd={(_e: any, info: any) => {
          if (Math.abs(info.offset.x) > 75 || Math.abs(info.velocity.x) > 400) onSwipeRemove(item);
        }}
        className="pos-mobile-cart-row relative grid touch-pan-y grid-cols-[minmax(0,1fr)_112px_92px] items-center gap-2 bg-surface px-3 py-3"
      >
        <button
          type="button"
          aria-label={`Edit ${item.name}`}
          title="Unit aur quantity chunein"
          disabled={locked}
          onClick={() => openEditItemModal(item)}
          className="min-w-0 cursor-pointer text-left active:opacity-70"
        >
          <span className="block truncate text-sm font-bold leading-tight text-fg">{item.name}</span>
          <LineMeta item={item} compact />
        </button>

        <div className="flex flex-col items-center gap-1">
          <QtyStepper item={item} size="md" locked={locked} updateQty={updateQty} setDirectQty={setDirectQty} />
          <button
            type="button"
            disabled={locked}
            onClick={() => openEditItemModal(item)}
            className="flex h-6 max-w-[104px] cursor-pointer items-center gap-0.5 rounded-md px-1.5 text-[11px] font-bold text-brand-fg"
          >
            <span className="truncate">{item.unit}</span>
            <ChevronDown className="size-3 shrink-0 opacity-70" aria-hidden="true" />
          </button>
        </div>

        <div className="text-right">
          <input
            type="number"
            inputMode="decimal"
            aria-label={`${item.name} line total`}
            title="Total likhein, quantity khud ban jayegi"
            step="any"
            value={item.customTotal !== undefined ? item.customTotal : (item.qty === 0 ? '' : lineTotal)}
            placeholder="0"
            disabled={locked}
            onChange={e => updateLineTotal(item.cartItemId, e.target.value)}
            onWheel={blurOnWheel}
            className={cn(amountInput, 'h-10 w-full border-line bg-surface-2 text-sm font-bold')}
          />
          {saving.total > 0 && (
            <span className="mt-0.5 block text-[11px] font-semibold tabular-nums text-success-fg">-{formatCurrency(saving.total)}</span>
          )}
        </div>
      </MotionDiv>
    </div>
  );
});
