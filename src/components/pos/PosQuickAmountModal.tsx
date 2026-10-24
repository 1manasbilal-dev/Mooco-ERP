import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, ArrowRight, Check, Minus, Plus, ShoppingCart, X, Zap } from 'lucide-react';
import { AvailableProduct } from './PosTypes';
import { PosProductImage } from './PosProductImage';
import { formatCurrency, formatQty, cleanNumber, cleanQty } from '../../lib/formatters';
import {
  calculateQuickEntry,
  getQuickPresets,
  hasConfiguredCashShortcuts,
  stepQuickQuantity,
} from '../../lib/posQuickEntry';
import { cartLineContains, qtyAfterUnitSwitch } from '../../lib/sellUnits';
import { cn } from '../../lib/cn';
import { defaultSellOption, optionStockText, posSellOptions, sellQtyProblem } from './posStock';
import { Button, IconButton } from '../ui';

interface Props {
  open: boolean;
  onClose: () => void;
  quickProduct: AvailableProduct | null;
  /** Optional starting mode/value, e.g. when a shortcut is tapped on the product detail page. */
  initialEntry?: { mode: 'amount' | 'qty'; value: string; variantId?: string } | null;
  cart: any[];
  allowNegativeStock: boolean;
  addToCart: (product: AvailableProduct, qty?: number, variantName?: string, price?: number, deduction?: number, variantId?: string, total?: number) => boolean;
  showToast: (message: string, type: any) => void;
  onAdded?: () => void;
}

export default function PosQuickAmountModal(props: Props) {
  if (!props.open || !props.quickProduct) return null;
  return <QuickEntry key={props.quickProduct.id} {...props} product={props.quickProduct} />;
}

export { PosQuickAmountModal };

function QuickEntry({ product, initialEntry, onClose, cart, allowNegativeStock, addToCart, showToast, onAdded }: Props & { product: AvailableProduct; key?: string }) {
  // Hidden packs are left out; loose only when loose sale is on. Each option knows its stock after the cart.
  const options = useMemo(() => posSellOptions(product, cart), [product, cart]);
  const variants = useMemo(() => (product.variants || []).filter(v => v.isActive !== false), [product.variants]);
  const looseAllowed = product.allow_loose_sale !== false;
  const isKgItem = (product.unit || '').toLowerCase() === 'kg';
  const isLiterItem = ['l', 'liter', 'liters'].includes((product.unit || '').toLowerCase());
  const seededVariantId = initialEntry?.variantId && options.some(o => o.id === initialEntry.variantId) ? initialEntry.variantId : null;
  // A loose shortcut (no variant) from the product page stays on loose even when loose stock is empty.
  const requested = seededVariantId || (initialEntry && !initialEntry.variantId && looseAllowed ? 'base' : null);
  const [variantId, setVariantId] = useState(() => defaultSellOption(options, requested)?.id || 'base');
  const option = options.find(o => o.id === variantId);
  const variant = variants.find(v => v.id === variantId);
  const packaged = option ? option.kind !== 'loose' : !looseAllowed;
  const contains = option?.contains || 1;
  const fromBase = option?.kind !== 'packed';
  const rate = option ? option.price : (Number(product.price) || 0);
  const unit = variant?.name || product.unit || 'Unit';
  const isFractional = !packaged && (isKgItem || isLiterItem);
  const minQty = isFractional ? (isKgItem ? 0.25 : 0.5) : 1;

  const seed = initialEntry && (seededVariantId || (looseAllowed && !initialEntry.variantId)) ? initialEntry : null;
  const [amount, setAmount] = useState(() => {
    if (seed) {
      if (seed.mode === 'amount') return seed.value;
      return String(cleanNumber(Number(seed.value) * rate));
    }
    return String(cleanNumber(rate > 0 ? rate : 100));
  });
  const [submitError, setSubmitError] = useState('');
  const [tappedPreset, setTappedPreset] = useState<number | null>(() => (seed && seed.mode === 'amount' ? Number(seed.value) : null));
  const panel = useRef<HTMLFormElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const committing = useRef(false);
  const titleId = useId();
  const errorId = useId();
  const summaryId = useId();

  const entry = calculateQuickEntry(amount, 'amount', rate, packaged);
  const total = entry.total;

  // What this unit can still sell after the cart, in its own unit (packs whole, dozen may be 1.5).
  const remaining = option?.available ?? 0;
  const sameUnitInCart = cart.filter(item => item.id === product.id && (item.variantId || 'base') === variantId).reduce((sum, item) => sum + (Number(item.qty) || 0), 0);
  const stockError = !option
    ? 'Is product ki koi unit abhi bikri ke liye nahi hai.'
    : !entry.error ? (sellQtyProblem(product.name, option, entry.qty, allowNegativeStock, product.unit || 'unit') || '') : '';
  const error = submitError || stockError || entry.error;
  const canAdd = !error;
  const leftAfter = option && !entry.error ? cleanQty(remaining - entry.qty) : null;

  // Presets: Cash buttons for loose items, pack counts for packaged items
  const cashPresets = useMemo(() => {
    if (packaged) return [];
    return getQuickPresets({ mode: 'amount', packaged: false, unit: product.unit, rate, configured: product.quick_amounts });
  }, [packaged, product.quick_amounts, product.unit, rate]);

  const packPresets = useMemo(() => {
    if (!packaged) return [];
    return getQuickPresets({ mode: 'qty', packaged: true, unit: product.unit, rate });
  }, [packaged, product.unit, rate]);

  const customCash = hasConfiguredCashShortcuts(product.quick_amounts);

  // The shared low-stock rule (reorder level, base unit), applied to what will be left after the cart.
  const { reading } = product.stock_view;
  const cartBase = cart.reduce((sum, line) => line.id === product.id ? sum + (Number(line.qty) || 0) * cartLineContains(line) : sum, 0);
  const lowAfterCart = reading.reorderLevel > 0 && reading.totalBase - cartBase <= reading.reorderLevel;
  const stockTone = remaining <= 0 ? (allowNegativeStock ? 'low' : 'out') : (lowAfterCart || reading.status === 'minus') ? 'low' : 'ok';
  const stockLabel = remaining <= 0
    ? (allowNegativeStock ? 'No stock · minus allowed' : 'Out of stock')
    : `${formatQty(remaining, 3)} ${unit} left`;

  useLayoutEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const root = document.querySelector<HTMLElement>('.mooco-app');
    const previousHidden = root?.getAttribute('aria-hidden');
    const wasInert = root?.hasAttribute('inert');
    const previousOverflow = document.body.style.overflow;
    if (window.matchMedia('(min-width: 768px) and (pointer: fine)').matches) {
      input.current?.focus({ preventScroll: true }); input.current?.select();
    } else panel.current?.focus({ preventScroll: true });
    root?.setAttribute('inert', ''); root?.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = 'hidden';
    return () => {
      if (!wasInert) root?.removeAttribute('inert');
      if (previousHidden === null || previousHidden === undefined) root?.removeAttribute('aria-hidden');
      else root?.setAttribute('aria-hidden', previousHidden);
      document.body.style.overflow = previousOverflow;
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);

  const refocus = () => { if (window.matchMedia('(pointer: fine)').matches) { input.current?.focus(); input.current?.select(); } };

  const switchVariant = (next: string) => {
    const nextOption = options.find(item => item.id === next);
    if (!nextOption) return;
    setVariantId(next);
    // Keep the same stock quantity like the cart does: 24 loose eggs become 2 Dozen, not 24 Dozen.
    const currentQty = entry.error || entry.qty <= 0 ? 1 : entry.qty;
    const switched = qtyAfterUnitSwitch(currentQty, contains, nextOption.contains, nextOption.kind !== 'loose');
    setAmount(String(cleanNumber(switched.qty * nextOption.price)));
    setSubmitError('');
    setTappedPreset(null);
  };

  /** Step quantity with [-] and [+] while updating price in the field */
  const stepValue = (direction: number) => {
    const currentQty = entry.error || entry.qty <= 0 ? 1 : entry.qty;
    const nextQty = stepQuickQuantity(currentQty, direction, product.unit, packaged);
    setAmount(String(cleanNumber(nextQty * rate)));
    setSubmitError('');
    setTappedPreset(null);
  };

  const handleAmountChange = (val: string) => {
    setAmount(val);
    setSubmitError('');
    setTappedPreset(null);
  };

  const add = () => {
    if (!canAdd || committing.current) return;
    committing.current = true;
    const finalTotal = entry.total;
    const added = addToCart(product, entry.qty, variant?.name, rate, contains, variant?.id, finalTotal);
    if (!added) {
      committing.current = false;
      setSubmitError('Could not add this item. Check stock and try again.');
      return;
    }
    showToast(`${formatQty(entry.qty, 3)} ${unit} added · ${formatCurrency(finalTotal)}`, 'success');
    onClose();
    if (onAdded) requestAnimationFrame(onAdded);
  };

  const tapCashPreset = (presetAmt: number) => {
    if (tappedPreset === presetAmt && canAdd) { add(); return; }
    setAmount(String(presetAmt));
    setTappedPreset(presetAmt);
    setSubmitError('');
  };

  const tapPackPreset = (packs: number) => {
    const packAmount = cleanNumber(packs * rate);
    if (tappedPreset === packAmount && canAdd) { add(); return; }
    setAmount(String(packAmount));
    setTappedPreset(packAmount);
    setSubmitError('');
  };

  const decreaseDisabled = !entry.error && entry.qty <= minQty + 0.001;

  const humanQtyBadge = useMemo(() => {
    if (entry.qty <= 0) return null;
    const isLiter = /liter|litre|\bl\b/i.test(unit || product.unit || '');
    const isKg = /kg|kilo/i.test(unit || product.unit || '');
    if (isLiter && entry.qty < 1) return `~${Math.round(entry.qty * 1000)} ml`;
    if (isKg && entry.qty < 1) return `~${Math.round(entry.qty * 1000)} g`;
    return null;
  }, [entry.qty, unit, product.unit]);

  return createPortal(
    <div className="pos-quick-overlay" onPointerDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <form
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="pos-quick-dialog"
        onSubmit={event => { event.preventDefault(); add(); }}
        onKeyDown={event => {
          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); return; }
          if (event.key === 'Enter' && event.repeat) { event.preventDefault(); return; }
          if (event.key !== 'Tab') return;
          const controls = Array.from((panel.current as HTMLFormElement | null)?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex="0"]') || []).filter(node => node.getClientRects().length);
          const first = controls[0], last = controls[controls.length - 1];
          if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel.current)) { event.preventDefault(); first?.focus(); }
        }}
      >
        <div className="pos-quick-header">
          <PosProductImage name={product.name} imageUrl={product.image_url} className="size-14 rounded-2xl" />
          <div className="pos-quick-heading">
            <span className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-[0.12em] text-brand-fg"><Zap className="size-3" aria-hidden="true" />Quick entry</span>
            <h2 id={titleId}>{product.name}</h2>
            <div className="pos-quick-meta">
              <span className="tabular-nums">{formatCurrency(rate)} / {unit}</span>
              <span className="pos-quick-chip" data-tone={stockTone}>{stockLabel}</span>
              {sameUnitInCart > 0 && <span className="pos-quick-chip" data-tone="cart">{formatQty(sameUnitInCart, 3)} in cart</span>}
            </div>
          </div>
          <IconButton variant="secondary" aria-label="Close quick entry" icon={<X />} onClick={onClose} className="self-start" />
        </div>

        <div className="pos-quick-body">
          {variants.length > 0 && options.length > 0 && (
            <>
              <div className="pos-quick-section-label"><span>Unit / packaging</span><span>Stock cart ke baad</span></div>
              <div className="pos-quick-units" role="group" aria-label="Unit / packaging">
                {options.map(o => {
                  const title = o.kind === 'loose' ? `1 ${product.unit}` : `${o.name} (${formatQty(o.contains, 3)} ${product.unit})`;
                  const empty = o.available <= 0;
                  return (
                    <button
                      key={o.id}
                      type="button"
                      aria-pressed={variantId === o.id}
                      aria-label={`${title}, ${formatCurrency(o.price)}, ${optionStockText(o, product.unit)}`}
                      disabled={empty && !allowNegativeStock && variantId !== o.id}
                      className="disabled:cursor-not-allowed disabled:opacity-55"
                      onClick={() => switchVariant(o.id)}
                    >
                      <strong>{title}</strong>
                      <span>{formatCurrency(o.price)}</span>
                      <small className={cn('text-[11px] font-semibold tabular-nums', empty ? (allowNegativeStock ? 'text-warning-fg' : 'text-danger-fg') : 'text-fg-subtle')}>
                        {empty ? (o.pileLeft < 0 ? 'Minus stock' : 'Out of stock') : optionStockText(o, product.unit)}
                      </small>
                    </button>
                  );
                })}
              </div>
            </>
          )}

          <div className="pos-quick-input-block">
            <div className="pos-quick-input-heading">
              <label htmlFor={`${titleId}-input`}>
                {packaged ? 'Sale amount (Rupees)' : 'Enter sale amount (Rupees)'}
              </label>
              <button type="button" onClick={() => { setAmount(''); setSubmitError(''); refocus(); }} disabled={!amount}>
                Clear
              </button>
            </div>
            <div className="pos-quick-value">
              <button type="button" aria-label="Decrease quick quantity" disabled={decreaseDisabled} onClick={() => stepValue(-1)}>
                <Minus className="size-5" />
              </button>
              <span className="pos-quick-prefix">Rs</span>
              <input
                ref={input}
                id={`${titleId}-input`}
                aria-label="Sale amount in rupees"
                inputMode="decimal"
                autoComplete="off"
                placeholder={String(rate > 0 ? rate : '170')}
                value={amount}
                onChange={event => handleAmountChange(event.target.value)}
                onFocus={event => event.currentTarget.select()}
                onKeyDown={event => {
                  if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                    event.preventDefault();
                    stepValue(event.key === 'ArrowUp' ? 1 : -1);
                  }
                }}
                aria-describedby={error ? `${summaryId} ${errorId}` : summaryId}
                aria-invalid={Boolean(amount && error)}
              />
              {entry.qty > 0 && !entry.error && (
                <div className="pos-quick-qty-badge" title="Equivalent quantity">
                  <strong>{formatQty(entry.qty, 3)}</strong>
                  <span>{unit}</span>
                </div>
              )}
              <button type="button" aria-label="Increase quick quantity" onClick={() => stepValue(1)}>
                <Plus className="size-5" />
              </button>
            </div>
            <div id={summaryId} className="pos-quick-conversion">
              <span>
                {variant && fromBase
                  ? `= ${formatQty(entry.qty, 3)} ${unit} = ${formatQty(entry.qty * contains, 3)} ${product.unit} @ ${formatCurrency(rate)}/${unit}`
                  : `= ${formatQty(entry.qty, 3)} ${unit} @ ${formatCurrency(rate)}/${unit}`}
                {humanQtyBadge && <span className="pos-quick-tag">{humanQtyBadge}</span>}
                {amount && Number(amount) > 0 && !packaged && <span className="pos-quick-tag">{formatCurrency(Number(amount))} custom amount</span>}
              </span>
              <span>
                {`${formatQty(remaining, 3)} ${unit} available`}
                {leftAfter !== null && leftAfter >= 0 && ` · ${formatQty(leftAfter, 3)} left after this`}
                {leftAfter !== null && leftAfter < 0 && allowNegativeStock && ` · ${formatQty(-leftAfter, 3)} minus (allowed)`}
              </span>
            </div>
          </div>

          {!packaged && cashPresets.length > 0 && (
            <>
              <div className="pos-quick-section-label pos-quick-presets-heading">
                <span>{customCash ? "This product's cash buttons" : 'Popular amounts'}</span>
                <span>Tap to fill · tap again to add</span>
              </div>
              <div className="pos-quick-presets">
                {cashPresets.map(presetAmt => {
                  const portion = calculateQuickEntry(String(presetAmt), 'amount', rate, false);
                  const disabled = Boolean(portion.error) || (!allowNegativeStock && portion.qty > remaining + .01);
                  const isSelected = !entry.error && Number(amount) === presetAmt;
                  return (
                    <button
                      type="button"
                      key={`cash-${presetAmt}`}
                      disabled={disabled}
                      aria-pressed={isSelected}
                      data-armed={tappedPreset === presetAmt || undefined}
                      onClick={() => tapCashPreset(presetAmt)}
                    >
                      <strong>{formatCurrency(presetAmt)}</strong>
                      <span>{portion.qty > 0 ? `${formatQty(portion.qty, 3)} ${unit}` : ''}</span>
                      {isSelected && <Check aria-hidden="true" />}
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {packaged && packPresets.length > 0 && (
            <>
              <div className="pos-quick-section-label pos-quick-presets-heading">
                <span>Quick pack count</span>
                <span>Tap to fill · tap again to add</span>
              </div>
              <div className="pos-quick-presets">
                {packPresets.map(presetPacks => {
                  const packAmount = cleanNumber(presetPacks * rate);
                  const disabled = !allowNegativeStock && presetPacks > remaining + .01;
                  const isSelected = !entry.error && Number(amount) === packAmount;
                  return (
                    <button
                      type="button"
                      key={`pack-${presetPacks}`}
                      disabled={disabled}
                      aria-pressed={isSelected}
                      data-armed={tappedPreset === packAmount || undefined}
                      onClick={() => tapPackPreset(presetPacks)}
                    >
                      <strong>{presetPacks} {unit}</strong>
                      <span>{formatCurrency(packAmount)}</span>
                      {isSelected && <Check aria-hidden="true" />}
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {error && (
            <p id={errorId} className="pos-quick-error" role="status" aria-live="polite">
              <AlertCircle className="size-4 shrink-0" aria-hidden="true" />{error}
            </p>
          )}
        </div>

        <div className="pos-quick-footer">
          <div>
            <span>{formatQty(entry.qty, 3)} {unit}{sameUnitInCart > 0 ? ` · ${formatQty(sameUnitInCart, 3)} already in cart` : ''}</span>
            <strong>{formatCurrency(total)}</strong>
          </div>
          <Button type="submit" size="lg" disabled={!canAdd} leftIcon={<ShoppingCart />} rightIcon={<ArrowRight />} className="shrink-0">
            Add to cart
          </Button>
        </div>
      </form>
    </div>,
    document.body
  );
}
