import React, { useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, Check, Minus, Plus, ShoppingCart, X, Zap, Package, Layers } from 'lucide-react';
import { AvailableProduct } from './PosTypes';
import { PosProductImage } from './PosProductImage';
import { formatCurrency, formatQty, cleanQty, cleanNumber } from '../../lib/formatters';
import {
  calculateQuickEntry,
  getQuickPresets,
  hasConfiguredCashShortcuts,
  stepQuickQuantity,
  stepWholeQuantity
} from '../../lib/posQuickEntry';
import { MOOCO_THEME } from '../../theme';
import { reservedBaseQty, sellUnitContains, sellUnitPrice } from '../../lib/sellUnits';

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

export function PosQuickAmountModal(props: Props) {
  if (!props.open || !props.quickProduct) return null;
  return <QuickEntry key={props.quickProduct.id} {...props} product={props.quickProduct} />;
}

const LOW_STOCK_LIMIT = 5;

function QuickEntry({ product, initialEntry, onClose, cart, allowNegativeStock, addToCart, showToast, onAdded }: Props & { product: AvailableProduct; key?: string }) {
  const variants = (product.variants || []).filter((v: any) => v.isActive !== false);
  const hasVariants = variants.length > 0;
  const looseAllowed = product.allow_loose_sale !== false;
  const isKgItem = (product.unit || '').toLowerCase() === 'kg';
  const isLiterItem = ['l', 'liter', 'liters'].includes((product.unit || '').toLowerCase());
  
  const seededVariantId = initialEntry?.variantId && variants.some(v => v.id === initialEntry.variantId) ? initialEntry.variantId : null;
  const [variantId, setVariantId] = useState(
    seededVariantId || (looseAllowed ? 'base' : (variants.find(v => Number(product.variant_stocks?.[v.id]) > 0)?.id || variants[0]?.id || 'base'))
  );
  
  const variant = variants.find(v => v.id === variantId);
  const packaged = variantId !== 'base' || !looseAllowed;
  const contains = variant ? sellUnitContains(variant) : 1;
  const fromBase = !variant || variant.deduct_from_base === true;
  const rate = variant ? sellUnitPrice(Number(product.price) || 0, contains, variant.selling_price) : (Number(product.price) || 0);
  const unit = variant?.name || product.unit || 'Unit';
  const isFractional = !packaged && (isKgItem || isLiterItem);
  const minQty = isFractional ? (isKgItem ? 0.25 : 0.5) : 1;

  // Entry Mode: 'qty' for packaging/count items, 'amount' for loose cash sales
  const [entryMode, setEntryMode] = useState<'qty' | 'amount'>(() => {
    if (initialEntry?.mode) return initialEntry.mode;
    if (hasVariants || packaged) return 'qty';
    return 'amount';
  });

  const [valueStr, setValueStr] = useState<string>(() => {
    if (initialEntry?.value) return initialEntry.value;
    if (hasVariants || packaged) return '1';
    return String(cleanNumber(rate > 0 ? rate : 100));
  });

  const [submitError, setSubmitError] = useState('');
  const [tappedPreset, setTappedPreset] = useState<number | null>(null);

  const panel = useRef<HTMLFormElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const committing = useRef(false);
  const titleId = useId();
  const errorId = useId();
  const summaryId = useId();

  const entry = useMemo(() => {
    return calculateQuickEntry(valueStr, entryMode, rate, packaged);
  }, [valueStr, entryMode, rate, packaged]);

  const total = entry.total;

  const mainStock = Number(product.stock) || 0;
  const packedStock = Number(product.variant_stocks?.[variantId]) || 0;
  const reserved = fromBase ? reservedBaseQty(cart, product.id) : cart.filter(item => item.id === product.id && (item.variantId || 'base') === variantId).reduce((sum, item) => sum + (Number(item.qty) || 0), 0);
  const stockPool = fromBase ? Math.max(0, mainStock - reserved) : Math.max(0, packedStock - reserved);
  const remaining = fromBase && variant ? stockPool / contains : stockPool;
  const sameUnitInCart = cart.filter(item => item.id === product.id && (item.variantId || 'base') === variantId).reduce((sum, item) => sum + (Number(item.qty) || 0), 0);
  const stockError = !entry.error && !allowNegativeStock && entry.qty > remaining + .01 ? `Only ${formatQty(remaining, 3)} ${unit} available after your cart.` : '';
  const error = submitError || stockError || entry.error;
  const canAdd = !error && entry.qty > 0;

  // Presets
  const cashPresets = useMemo(() => {
    if (entryMode === 'qty') return [];
    return getQuickPresets({ mode: 'amount', packaged: false, unit: product.unit, rate, configured: product.quick_amounts });
  }, [entryMode, product.quick_amounts, product.unit, rate]);

  const qtyPresets = useMemo(() => {
    if (entryMode !== 'qty') return [];
    if (isFractional) return [0.5, 1, 1.5, 2, 3, 5];
    return [1, 2, 3, 5, 10];
  }, [entryMode, isFractional]);

  const customCash = hasConfiguredCashShortcuts(product.quick_amounts);
  const stockTone = remaining <= 0 && !allowNegativeStock ? 'out' : remaining <= LOW_STOCK_LIMIT ? 'low' : 'ok';
  const stockLabel = allowNegativeStock && remaining <= 0 ? 'Stock override on' : stockTone === 'out' ? 'Out of stock' : `${formatQty(remaining, 3)} ${unit} left`;

  useLayoutEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const root = document.querySelector<HTMLElement>('.mooco-app');
    const previousHidden = root?.getAttribute('aria-hidden');
    const wasInert = root?.hasAttribute('inert');
    const previousOverflow = document.body.style.overflow;
    if (window.matchMedia('(min-width: 768px) and (pointer: fine)').matches) {
      input.current?.focus({ preventScroll: true }); 
      input.current?.select();
    } else {
      panel.current?.focus({ preventScroll: true });
    }
    root?.setAttribute('inert', ''); 
    root?.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = 'hidden';
    return () => {
      if (!wasInert) root?.removeAttribute('inert');
      if (previousHidden === null || previousHidden === undefined) root?.removeAttribute('aria-hidden');
      else root?.setAttribute('aria-hidden', previousHidden);
      document.body.style.overflow = previousOverflow;
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);

  const refocus = () => { 
    if (window.matchMedia('(pointer: fine)').matches) { 
      input.current?.focus(); 
      input.current?.select(); 
    } 
  };

  const switchVariant = (nextId: string) => {
    setVariantId(nextId);
    setSubmitError('');
    setTappedPreset(null);
    const v = variants.find(item => item.id === nextId);
    const isNowPackaged = nextId !== 'base' || !looseAllowed;
    
    if (entryMode === 'amount') {
      const nextContains = v ? sellUnitContains(v) : 1;
      const nextRate = v ? sellUnitPrice(Number(product.price) || 0, nextContains, v.selling_price) : (Number(product.price) || 0);
      const currentQty = entry.error || entry.qty <= 0 ? 1 : entry.qty;
      setValueStr(String(cleanNumber(currentQty * nextRate)));
    } else {
      // In qty mode, keep the current count (e.g. 1 or 2)
      if (!valueStr || Number(valueStr) <= 0) {
        setValueStr('1');
      }
    }
    if (isNowPackaged && entryMode === 'amount') {
      setEntryMode('qty');
      setValueStr('1');
    }
  };

  const stepValue = (direction: number) => {
    setSubmitError('');
    setTappedPreset(null);
    if (entryMode === 'qty') {
      const currentQty = parseFloat(valueStr) || 1;
      let nextQty: number;
      if (isFractional) {
        const step = currentQty < 2 ? 0.25 : 0.5;
        nextQty = direction > 0 ? currentQty + step : Math.max(minQty, currentQty - step);
      } else {
        nextQty = Math.max(1, direction > 0 ? Math.floor(currentQty) + 1 : Math.ceil(currentQty) - 1);
      }
      setValueStr(String(cleanQty(nextQty)));
    } else {
      const currentQty = entry.error || entry.qty <= 0 ? 1 : entry.qty;
      const nextQty = stepQuickQuantity(currentQty, direction, product.unit, packaged);
      const nextAmount = cleanNumber(nextQty * rate);
      setValueStr(String(nextAmount));
    }
  };

  const handleInputChange = (val: string) => {
    setValueStr(val);
    setSubmitError('');
    setTappedPreset(null);
  };

  const add = () => {
    if (!canAdd || committing.current) return;
    committing.current = true;
    const finalTotal = entry.total;
    const added = addToCart(
      product,
      entry.qty,
      variant?.name,
      rate,
      contains,
      variant?.id,
      finalTotal
    );
    if (!added) {
      committing.current = false;
      setSubmitError('Could not add this item. Check stock and try again.');
      return;
    }
    showToast(`${formatQty(entry.qty, 3)} ${unit} added · Rs ${formatCurrency(finalTotal)}`, 'success');
    onClose();
    if (onAdded) requestAnimationFrame(onAdded);
  };

  const tapQtyPreset = (q: number) => {
    if (tappedPreset === q && canAdd) {
      add();
      return;
    }
    setValueStr(String(q));
    setTappedPreset(q);
    setSubmitError('');
  };

  const tapCashPreset = (presetAmt: number) => {
    if (tappedPreset === presetAmt && canAdd) {
      add();
      return;
    }
    setValueStr(String(presetAmt));
    setTappedPreset(presetAmt);
    setSubmitError('');
  };

  const decreaseDisabled = !entry.error && entry.qty <= minQty + 0.001;

  return createPortal(
    <div className="pos-quick-overlay" onPointerDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <form
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="pos-quick-dialog max-w-lg"
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
        {/* Header */}
        <div className="pos-quick-header">
          <PosProductImage name={product.name} imageUrl={product.image_url} className="pos-quick-image" />
          <div className="pos-quick-heading">
            <span className="pos-eyebrow flex items-center gap-1 text-lime-700 dark:text-lime-400 font-bold text-[11px] uppercase tracking-wider">
              <Package size={12} />
              {hasVariants ? 'Select Packaging Unit' : 'Quick Add to Cart'}
            </span>
            <h2 id={titleId} className="text-base sm:text-lg font-bold text-slate-900 dark:text-white">
              {product.name}
            </h2>
            <div className="pos-quick-meta">
              <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                1 {unit} @ Rs {formatCurrency(rate)}
              </p>
              <span className="pos-quick-chip" data-tone={stockTone}>{stockLabel}</span>
              {sameUnitInCart > 0 && (
                <span className="pos-quick-chip" data-tone="cart">
                  {formatQty(sameUnitInCart, 3)} in cart
                </span>
              )}
            </div>
          </div>
          <button type="button" className="pos-icon-button cursor-pointer" aria-label="Close" onClick={onClose}>
            <X size={19} />
          </button>
        </div>

        {/* Body */}
        <div className="pos-quick-body p-4 sm:p-5 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* Packaging / Unit Selector Cards */}
          {hasVariants && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                  <Layers size={13} className="text-lime-600 dark:text-lime-400" />
                  Choose Packaging Unit
                </span>
                <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                  Selected: <strong className="text-lime-700 dark:text-lime-400">{unit}</strong>
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {/* Base Unit Card */}
                {looseAllowed && (
                  <button
                    type="button"
                    onClick={() => switchVariant('base')}
                    className={`p-3 rounded-2xl text-left border-2 transition-all cursor-pointer active:scale-98 relative flex flex-col justify-between ${
                      variantId === 'base'
                        ? 'bg-lime-50/90 dark:bg-lime-950/40 border-lime-600 dark:border-lime-500 shadow-xs ring-2 ring-lime-500/20'
                        : 'bg-white dark:bg-slate-800/80 border-slate-200 dark:border-slate-700 hover:border-lime-400 dark:hover:border-lime-600'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <span className="text-xs font-black text-slate-900 dark:text-white">
                        1 {product.unit} (Base)
                      </span>
                      {variantId === 'base' && (
                        <span className="w-4 h-4 rounded-full bg-lime-600 text-white flex items-center justify-center text-[10px] shrink-0">
                          <Check size={10} className="stroke-[3]" />
                        </span>
                      )}
                    </div>
                    <div className="mt-2 flex items-baseline justify-between">
                      <span className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">Single item</span>
                      <span className="text-sm font-black font-mono text-lime-700 dark:text-lime-400">
                        Rs {formatCurrency(Number(product.price) || 0)}
                      </span>
                    </div>
                  </button>
                )}

                {/* Packaging Variants Cards (Dozen, Tray, etc.) */}
                {variants.map(v => {
                  const size = sellUnitContains(v);
                  const packPrice = sellUnitPrice(Number(product.price) || 0, size, v.selling_price);
                  const isSelected = variantId === v.id;
                  const eachPrice = size > 0 ? (packPrice / size) : packPrice;

                  return (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => switchVariant(v.id)}
                      className={`p-3 rounded-2xl text-left border-2 transition-all cursor-pointer active:scale-98 relative flex flex-col justify-between ${
                        isSelected
                          ? 'bg-lime-50/90 dark:bg-lime-950/40 border-lime-600 dark:border-lime-500 shadow-xs ring-2 ring-lime-500/20'
                          : 'bg-white dark:bg-slate-800/80 border-slate-200 dark:border-slate-700 hover:border-lime-400 dark:hover:border-lime-600'
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <span className="text-xs font-black text-slate-900 dark:text-white truncate pr-2">
                          {v.name}
                        </span>
                        {isSelected && (
                          <span className="w-4 h-4 rounded-full bg-lime-600 text-white flex items-center justify-center text-[10px] shrink-0">
                            <Check size={10} className="stroke-[3]" />
                          </span>
                        )}
                      </div>
                      <div className="mt-2 flex items-baseline justify-between">
                        <span className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                          {size} {product.unit} <span className="text-[10px] opacity-75">(@{formatCurrency(eachPrice)})</span>
                        </span>
                        <span className="text-sm font-black font-mono text-lime-700 dark:text-lime-400">
                          Rs {formatCurrency(packPrice)}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Mode Switcher for loose items (Quantity vs Rupees) */}
          {looseAllowed && !packaged && (
            <div className="flex items-center justify-center gap-1.5 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
              <button
                type="button"
                onClick={() => {
                  setEntryMode('qty');
                  setValueStr('1');
                  setTappedPreset(null);
                }}
                className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  entryMode === 'qty'
                    ? 'bg-white dark:bg-slate-700 text-lime-700 dark:text-lime-300 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                }`}
              >
                By Quantity ({unit})
              </button>
              <button
                type="button"
                onClick={() => {
                  setEntryMode('amount');
                  setValueStr(String(cleanNumber(rate > 0 ? rate : 100)));
                  setTappedPreset(null);
                }}
                className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  entryMode === 'amount'
                    ? 'bg-white dark:bg-slate-700 text-lime-700 dark:text-lime-300 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                }`}
              >
                By Cash (Rupees)
              </button>
            </div>
          )}

          {/* Stepper Input Block */}
          <div className="pos-quick-input-block">
            <div className="pos-quick-input-heading flex items-center justify-between">
              <label htmlFor={`${titleId}-input`} className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                {entryMode === 'qty' ? `Quantity (${unit})` : 'Sale Amount (Rupees)'}
              </label>
              <button
                type="button"
                onClick={() => { setValueStr(''); setSubmitError(''); refocus(); }}
                disabled={!valueStr}
                className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
              >
                Clear
              </button>
            </div>

            <div className="pos-quick-value flex items-center gap-2 mt-1.5">
              <button
                type="button"
                aria-label="Decrease"
                disabled={decreaseDisabled}
                onClick={() => stepValue(-1)}
                className="w-12 h-12 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 flex items-center justify-center font-bold active:scale-95 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Minus size={18} />
              </button>

              <div className="flex-1 relative flex items-center">
                {entryMode === 'amount' && (
                  <span className="absolute left-3 text-sm font-bold text-slate-400 select-none">
                    Rs
                  </span>
                )}
                <input
                  ref={input}
                  id={`${titleId}-input`}
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  value={valueStr}
                  onChange={event => handleInputChange(event.target.value)}
                  onFocus={event => event.currentTarget.select()}
                  onKeyDown={event => {
                    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                      event.preventDefault();
                      stepValue(event.key === 'ArrowUp' ? 1 : -1);
                    }
                  }}
                  className={`w-full text-center text-xl sm:text-2xl font-black font-mono py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-850 text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-lime-500/20 focus:border-lime-500 ${
                    entryMode === 'amount' ? 'pl-9 pr-3' : 'px-3'
                  }`}
                  placeholder={entryMode === 'qty' ? '1' : String(rate)}
                />
              </div>

              <button
                type="button"
                aria-label="Increase"
                onClick={() => stepValue(1)}
                className="w-12 h-12 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 flex items-center justify-center font-bold active:scale-95 transition-all cursor-pointer"
              >
                <Plus size={18} />
              </button>
            </div>

            {/* Live Conversion Banner */}
            <div id={summaryId} className="mt-2.5 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-850 border border-slate-200/70 dark:border-slate-800 flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-700 dark:text-slate-300">
                {variant && fromBase
                  ? `= ${formatQty(entry.qty, 3)} ${unit} (${formatQty(entry.qty * contains, 3)} ${product.unit}) @ Rs ${formatCurrency(rate)}/${unit}`
                  : `= ${formatQty(entry.qty, 3)} ${unit} @ Rs ${formatCurrency(rate)}/${unit}`}
              </span>
              <span className="font-black text-lime-700 dark:text-lime-400 font-mono text-sm">
                Rs {formatCurrency(total)}
              </span>
            </div>
          </div>

          {/* Quick Presets: Qty Pills */}
          {entryMode === 'qty' && qtyPresets.length > 0 && (
            <div className="space-y-1.5">
              <div className="flex justify-between items-center text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                <span>Quick Quantity</span>
                <span className="normal-case font-normal text-slate-400">Tap to set quantity</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {qtyPresets.map(presetQty => {
                  const isSelected = !entry.error && Number(valueStr) === presetQty;
                  return (
                    <button
                      key={`qty-${presetQty}`}
                      type="button"
                      onClick={() => tapQtyPreset(presetQty)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all cursor-pointer active:scale-95 ${
                        isSelected
                          ? 'bg-lime-600 text-white border-lime-600 shadow-xs'
                          : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:border-lime-500'
                      }`}
                    >
                      {presetQty} {unit}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Quick Presets: Cash Pills for Loose mode */}
          {entryMode === 'amount' && cashPresets.length > 0 && (
            <div className="space-y-1.5">
              <div className="flex justify-between items-center text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                <span>{customCash ? "Product cash buttons" : 'Popular cash amounts'}</span>
                <span className="normal-case font-normal text-slate-400">Tap to fill</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {cashPresets.map(presetAmt => {
                  const isSelected = !entry.error && Number(valueStr) === presetAmt;
                  return (
                    <button
                      key={`cash-${presetAmt}`}
                      type="button"
                      onClick={() => tapCashPreset(presetAmt)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all cursor-pointer active:scale-95 ${
                        isSelected
                          ? 'bg-lime-600 text-white border-lime-600 shadow-xs'
                          : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:border-lime-500'
                      }`}
                    >
                      Rs {presetAmt}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {error && (
            <p id={errorId} className="text-xs font-semibold text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 p-2.5 rounded-xl border border-rose-200 dark:border-rose-900" role="status">
              {error}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="pos-quick-footer p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-850 flex items-center justify-between gap-3">
          <div>
            <span className="text-xs text-slate-500 dark:text-slate-400 font-medium block">
              {formatQty(entry.qty, 3)} {unit}
            </span>
            <strong className="text-base sm:text-lg font-black font-mono text-slate-900 dark:text-white">
              Rs {formatCurrency(total)}
            </strong>
          </div>
          <button 
            type="submit" 
            disabled={!canAdd} 
            className="flex-1 max-w-xs py-3 px-5 rounded-2xl bg-lime-600 hover:bg-lime-700 text-white font-bold text-sm shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all cursor-pointer flex items-center justify-center gap-2 active:scale-98"
          >
            <ShoppingCart size={17} />
            <span>Add to Cart · Rs {formatCurrency(total)}</span>
            <ArrowRight size={16} />
          </button>
        </div>
      </form>
    </div>,
    document.body
  );
}
