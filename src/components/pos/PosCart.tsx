import React from 'react';
import { ShoppingCart, Trash2, ChevronLeft, Minus, Plus, Maximize2, ChevronDown } from 'lucide-react';
import { motion } from 'framer-motion';
import { formatCurrency } from '../../lib/formatters';
import { confirmAction } from '../ui/ConfirmDialog';

const MotionDiv = motion.div as any;

const getHumanFriendlyBadge = (item: any) => {
  const isLiter = /liter|litre|\bl\b/i.test(item.unit || item.baseUnit || '');
  const isKg = /kg|kilo/i.test(item.unit || item.baseUnit || '');
  let friendlyVol: string | null = null;
  if (isLiter && item.qty > 0 && item.qty < 1) {
    friendlyVol = `~${Math.round(item.qty * 1000)} ml`;
  } else if (isKg && item.qty > 0 && item.qty < 1) {
    friendlyVol = `~${Math.round(item.qty * 1000)} g`;
  }
  const hasCustomTotal = item.customTotal !== undefined;
  return { friendlyVol, hasCustomTotal, customTotal: item.customTotal };
};

interface PosCartProps {
  expanded: boolean;
  cart: any[];
  setCart: React.Dispatch<React.SetStateAction<any[]>>;
  setMobileTab: (tab: 'catalog' | 'cart') => void;
  updateQty: (cartItemId: string, delta: number) => void;
  setDirectQty: (cartItemId: string, val: string) => void;
  updateRate: (cartItemId: string, val: string) => void;
  updateLineTotal: (cartItemId: string, val: string) => void;
  openEditItemModal: (item: any) => void;
  getLineTotal: (item: any) => number;
  showToast: (msg: string, type: any) => void;
  onClearCart?: () => void;
}

export const PosCart: React.FC<PosCartProps> = ({
  expanded,
  cart,
  setCart,
  setMobileTab,
  updateQty,
  setDirectQty,
  updateRate,
  updateLineTotal,
  openEditItemModal,
  getLineTotal,
  showToast,
  onClearCart
}) => {
  const clearCartWithConfirm = async () => {
    const ok = await confirmAction({
      tone: 'warning',
      title: 'Cart khali karein?',
      consequences: [`Cart ke ${cart.length} item(s) hat jayenge.`, 'Abhi tak bill save nahi hua, is liye stock ya khaate par asar nahi hoga.'],
      confirmLabel: 'Haan, khali karein',
    });
    if (!ok) return;
    if (onClearCart) onClearCart();
    else setCart([]);
  };

  return (
    <>
      <div className="shrink-0 bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800 z-10">
        <div className="flex lg:hidden p-2.5 items-center justify-between bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
          <button
            type="button"
            onClick={() => setMobileTab('catalog')}
            className="flex items-center gap-1 text-xs font-bold text-slate-700 dark:text-slate-200 hover:text-slate-900 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 px-3 py-1.5 rounded-xl shadow-xs active:scale-95 transition-all cursor-pointer"
          >
            <ChevronLeft size={16} />
            <span>Products</span>
          </button>
          <div className="flex items-center gap-1.5 text-xs font-black text-slate-800 dark:text-slate-100">
            <ShoppingCart size={14} className="text-lime-600 dark:text-lime-400" />
            <span>Review Cart</span>
            {cart.length > 0 && (
              <span className="px-1.5 py-0.2 bg-lime-100 dark:bg-lime-900/60 text-lime-800 dark:text-lime-300 rounded-full text-[10px] font-mono font-bold">
                {cart.length}
              </span>
            )}
          </div>
          {cart.length > 0 ? (
            <button
              type="button"
              onClick={clearCartWithConfirm}
              className="text-[11px] font-bold text-red-600 hover:text-red-700 px-2.5 py-1 bg-red-50 dark:bg-red-950/40 rounded-lg transition-colors cursor-pointer"
            >
              Clear
            </button>
          ) : <div className="w-10" />}
        </div>

        <div className="hidden lg:flex px-3.5 py-1.5 justify-between items-center bg-white dark:bg-slate-900 text-xs font-bold text-slate-500 dark:text-slate-400 border-b border-slate-100 dark:border-slate-800">
          <button type="button" onClick={() => setMobileTab(expanded ? 'catalog' : 'cart')} className="flex items-center gap-1.5 text-lime-700 dark:text-lime-400 px-2 py-1 rounded-lg hover:bg-lime-50 dark:hover:bg-lime-950/40">
            {expanded ? <ChevronLeft size={14} /> : <Maximize2 size={14} />}{expanded ? 'Products' : 'Expand cart'}
          </button>
          <span className="flex items-center gap-1.5 text-slate-700 dark:text-slate-200">
            <ShoppingCart size={14} className="text-lime-600 dark:text-lime-400" /> Current Cart
            <span className="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 px-1.5 py-0.2 rounded-full font-mono text-[11px] border border-slate-200 dark:border-slate-700">
              {cart.length} item{cart.length !== 1 ? 's' : ''}
            </span>
          </span>
          {cart.length > 0 && (
            <button 
              onClick={clearCartWithConfirm}
              className="text-[11px] text-slate-400 hover:text-red-600 flex items-center gap-1 transition-colors cursor-pointer"
            >
              <Trash2 size={12} /> Clear
            </button>
          )}
        </div>
      </div>

      <div className="pos-cart-list flex-1 overflow-y-auto min-h-0 bg-white dark:bg-slate-900">
        {cart.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full py-12 text-slate-400">
            <div className="w-16 h-16 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm flex items-center justify-center text-slate-400 mb-3">
              <ShoppingCart size={28} className="opacity-40 text-lime-600 dark:text-lime-400" />
            </div>
            <p className="text-sm font-bold text-slate-700 dark:text-slate-200">Your Cart is Empty</p>
            <p className="text-[11px] text-slate-400 mt-1 text-center max-w-[220px]">
              Click any product from the catalog on the left to add items to order
            </p>
          </div>
        ) : (
          <>
            <div className="md:hidden">
              <div className="pos-mobile-cart-columns grid grid-cols-12 px-3 py-2 bg-slate-50 dark:bg-slate-800 border-b border-slate-100 dark:border-slate-700 text-[10px] uppercase font-bold text-slate-400 tracking-wider">
                <span className="col-span-5">Item</span>
                <span className="col-span-4 text-center">Qty</span>
                <span className="col-span-3 text-right">Total</span>
              </div>

              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {cart.map(item => {
                  const hasDiscount = item.originalPrice !== undefined && item.originalPrice > item.price;
                  const lineDiscount = hasDiscount ? (item.originalPrice - item.price) * item.qty : 0;
                  const lineTotal = getLineTotal(item);

                  return (
                    <div key={item.cartItemId} className="relative overflow-hidden bg-red-500">
                      <div className="absolute inset-0 flex items-center justify-between px-4 text-white text-xs font-bold">
                        <span className="flex items-center gap-1.5"><Trash2 size={15} /> Delete</span>
                        <span className="flex items-center gap-1.5">Delete <Trash2 size={15} /></span>
                      </div>

                      <MotionDiv
                        drag="x"
                        dragDirectionLock
                        dragConstraints={{ left: 0, right: 0 }}
                        dragElastic={0.6}
                        onDragEnd={(_e: any, info: any) => {
                          if (Math.abs(info.offset.x) > 75 || Math.abs(info.velocity.x) > 400) {
                            setCart(prev => prev.filter(c => c.cartItemId !== item.cartItemId));
                            showToast(`${item.name} cart se hata diya`, 'info');
                          }
                        }}
                        className="pos-mobile-cart-row relative bg-white dark:bg-slate-900 px-3 py-2.5 grid grid-cols-12 items-center gap-1.5 touch-pan-y"
                      >
                        <div className="pos-cart-item-name col-span-5 min-w-0 pr-1">
                          <button type="button" aria-label={`Edit ${item.name}`}
                            onClick={() => openEditItemModal(item)}
                            className="text-left cursor-pointer active:opacity-70 group block w-full"
                            title="Click to select unit & quantity"
                          >
                            <p className="font-bold text-slate-800 dark:text-slate-100 text-xs truncate leading-tight group-hover:text-lime-600 transition-colors">
                              {item.name}
                            </p>
                            <div className="flex items-center gap-1 flex-wrap mt-0.5">
                              <span className="text-xs text-slate-400 dark:text-slate-500 font-medium truncate">
                                {item.variantName ? `${item.variantName} · ` : ''}Rs {formatCurrency(item.price)}
                              </span>
                              {(() => {
                                const badge = getHumanFriendlyBadge(item);
                                return (
                                  <>
                                    {badge.friendlyVol && (
                                      <span className="text-[9px] font-bold px-1 py-0.2 rounded bg-lime-100 dark:bg-lime-950/60 text-lime-800 dark:text-lime-300">
                                        {badge.friendlyVol}
                                      </span>
                                    )}
                                    {badge.hasCustomTotal && (
                                      <span className="text-[9px] font-bold px-1 py-0.2 rounded bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300">
                                        Rs {badge.customTotal} custom
                                      </span>
                                    )}
                                  </>
                                );
                              })()}
                            </div>
                          </button>
                        </div>

                        <div className="pos-cart-quantity col-span-4 flex items-center justify-center gap-1">
                          <div className="flex items-center bg-slate-100 dark:bg-slate-800 rounded-lg p-0.5 border border-slate-200/60 dark:border-slate-700">
                            <button aria-label="Decrease" 
                              type="button"
                              onClick={() => updateQty(item.cartItemId, -1)} 
                              className="w-6 h-6 rounded-md hover:bg-white dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 active:scale-90 flex items-center justify-center transition-all cursor-pointer"
                              title="Decrease"
                            >
                              <Minus size={11} />
                            </button>
                            <input 
                              type="number"
                              aria-label={`${item.name} quantity`}
                              step="any"
                              value={item.qty}
                              onChange={e => setDirectQty(item.cartItemId, e.target.value)}
                              className="w-8 text-center text-xs font-bold font-mono text-slate-900 dark:text-slate-100 bg-transparent outline-none"
                            />
                            <button aria-label="Increase" 
                              type="button"
                              onClick={() => updateQty(item.cartItemId, 1)} 
                              className="w-6 h-6 rounded-md hover:bg-white dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 active:scale-90 flex items-center justify-center transition-all cursor-pointer"
                              title="Increase"
                            >
                              <Plus size={11} />
                            </button>
                          </div>
                          <button
                            type="button"
                            onClick={() => openEditItemModal(item)}
                            className="text-[10px] font-bold text-lime-700 dark:text-lime-300 bg-lime-50 dark:bg-lime-950/60 hover:bg-lime-100 dark:hover:bg-lime-900/60 px-1.5 py-1 rounded-md border border-lime-200 dark:border-lime-800 truncate max-w-[50px] cursor-pointer flex items-center gap-0.5 active:scale-95 shadow-2xs"
                            title="Click to select unit & quantity dialog"
                          >
                            <span className="truncate">{item.unit}</span>
                            <ChevronDown size={9} className="opacity-70 shrink-0" />
                          </button>
                        </div>

                        <div className="pos-cart-line-total col-span-3 text-right">
                          <div className="flex items-center justify-end">
                            <span className="text-[10px] text-slate-400 mr-0.5 font-mono">Rs</span>
                            <input
                              type="number"
                              aria-label={`${item.name} line total`}
                              step="any"
                              value={item.customTotal !== undefined ? item.customTotal : (item.qty === 0 ? '' : lineTotal)}
                              onChange={e => updateLineTotal(item.cartItemId, e.target.value)}
                              placeholder="0"
                              className="w-14 text-right text-xs font-black font-mono bg-transparent border border-transparent hover:border-slate-200 focus:border-lime-500 focus:bg-white dark:focus:bg-slate-800 rounded px-1 py-0.5 outline-none text-slate-900 dark:text-slate-100 transition-colors"
                              title="Click to edit total amount (auto-calculates quantity)"
                            />
                          </div>
                          {lineDiscount > 0 && (
                            <span className="text-[9px] text-emerald-600 dark:text-emerald-400 font-semibold font-mono block text-right">
                              -Rs {lineDiscount.toFixed(0)}
                            </span>
                          )}
                        </div>
                      </MotionDiv>
                    </div>
                  );
                })}
              </div>
            </div>

            <table className="hidden md:table w-full text-left border-collapse">
              <thead className="sticky top-0 bg-slate-50 dark:bg-slate-850 border-b border-slate-200 dark:border-slate-750 text-[10px] uppercase font-semibold text-slate-500 dark:text-slate-400 tracking-wider z-10">
                <tr>
                  <th className="py-2.5 px-3">Item & Unit</th>
                  <th className="py-2.5 px-2 text-right w-24">Rate</th>
                  <th className="py-2.5 px-2 text-center w-28">Qty</th>
                  <th className="py-2.5 px-3 text-right w-24">Total</th>
                  <th className="py-2.5 px-1 w-8 text-center"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                {cart.map(item => {
                  const hasDiscount = item.originalPrice !== undefined && item.originalPrice > item.price;
                  const lineDiscount = hasDiscount ? (item.originalPrice - item.price) * item.qty : 0;

                  return (
                    <tr 
                      key={item.cartItemId}
                      className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors group"
                    >
                      <td className="py-2.5 px-3 min-w-0">
                        <button type="button" aria-label={`Edit ${item.name}`} onClick={() => openEditItemModal(item)} className="text-left font-semibold text-slate-900 dark:text-slate-100 text-sm leading-snug hover:text-lime-600 dark:hover:text-lime-400 transition-colors block">
                          {item.name}
                        </button>
                        <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                          <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                            {item.variantName ? `${item.variantName} (${item.stockDeduction} ${item.baseUnit || 'pcs'})` : `${item.unit}`}
                          </span>
                          <span className="text-[10px] text-slate-300 dark:text-slate-600">•</span>
                          <span className="text-xs font-mono text-slate-500 dark:text-slate-400">
                            Rs {formatCurrency(item.price)}
                          </span>
                          {(() => {
                            const badge = getHumanFriendlyBadge(item);
                            return (
                              <>
                                {badge.friendlyVol && (
                                  <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-lime-100 dark:bg-lime-950/60 text-lime-800 dark:text-lime-300 shadow-2xs">
                                    {badge.friendlyVol}
                                  </span>
                                )}
                                {badge.hasCustomTotal && (
                                  <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 shadow-2xs">
                                    Rs {badge.customTotal} Custom Amount
                                  </span>
                                )}
                              </>
                            );
                          })()}
                        </div>
                      </td>

                      <td className="py-2.5 px-2 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end">
                          <span className="text-xs font-normal text-slate-400 mr-0.5 font-mono">Rs</span>
                          <input 
                            type="number" 
                            aria-label={`${item.name} rate`}
                            step="any" 
                            value={item.price} 
                            onChange={e => updateRate(item.cartItemId, e.target.value)} 
                            className="w-14 text-right text-xs sm:text-sm font-semibold font-mono bg-transparent border border-transparent hover:border-slate-200 focus:border-lime-500 focus:bg-white dark:focus:bg-slate-800 rounded px-1 py-0.5 outline-none text-slate-800 dark:text-slate-100 transition-colors"
                            title="Click to edit unit rate"
                          />
                        </div>
                        {hasDiscount && (
                          <span className="text-[9px] text-emerald-600 dark:text-emerald-400 font-medium font-mono block text-right mt-0.5" title="Discount per unit">
                            -Rs {(item.originalPrice - item.price).toFixed(0)}
                          </span>
                        )}
                      </td>

                      <td className="py-2.5 px-2 text-center whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5 justify-center">
                          <div className="flex items-center bg-slate-100 dark:bg-slate-800 rounded-lg p-0.5">
                            <button aria-label="Decrease quantity" 
                              type="button" 
                              onClick={() => updateQty(item.cartItemId, -1)} 
                              className="w-6 h-6 rounded-md hover:bg-white dark:hover:bg-slate-700 hover:shadow-xs text-slate-600 dark:text-slate-300 active:scale-95 flex items-center justify-center transition-all cursor-pointer"
                              title="Decrease quantity"
                            >
                              <Minus size={11} />
                            </button>
                            <input 
                              type="number" 
                              aria-label={`${item.name} quantity`}
                              step="any" 
                              value={item.qty} 
                              onChange={e => setDirectQty(item.cartItemId, e.target.value)} 
                              className="w-11 text-center text-xs font-semibold font-mono text-slate-900 dark:text-slate-100 bg-transparent outline-none"
                            />
                            <button aria-label="Increase quantity" 
                              type="button" 
                              onClick={() => updateQty(item.cartItemId, 1)} 
                              className="w-6 h-6 rounded-md hover:bg-white dark:hover:bg-slate-700 hover:shadow-xs text-slate-600 dark:text-slate-300 active:scale-95 flex items-center justify-center transition-all cursor-pointer"
                              title="Increase quantity"
                            >
                              <Plus size={11} />
                            </button>
                          </div>
                          <button
                            type="button"
                            onClick={() => openEditItemModal(item)}
                            className="text-[11px] font-bold text-lime-700 dark:text-lime-300 bg-lime-50 dark:bg-lime-950/60 hover:bg-lime-100 dark:hover:bg-lime-900/60 px-2.5 py-1 rounded-lg border border-lime-200 dark:border-lime-800 flex items-center gap-1 transition-all cursor-pointer shadow-2xs active:scale-95"
                            title="Click to select unit & quantity dialog"
                          >
                            <span>{item.unit}</span>
                            <ChevronDown size={11} className="opacity-70" />
                          </button>
                        </div>
                      </td>

                      <td className="py-2.5 px-3 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end">
                          <span className="text-xs font-normal text-slate-400 mr-0.5 font-mono">Rs</span>
                          <input 
                            type="number" 
                            aria-label={`${item.name} line total`}
                            step="any" 
                            value={item.customTotal !== undefined ? item.customTotal : (item.qty === 0 ? '' : getLineTotal(item))} 
                            onChange={e => updateLineTotal(item.cartItemId, e.target.value)} 
                            placeholder="0"
                            className="w-16 text-right text-xs sm:text-sm font-bold font-mono bg-transparent border border-transparent hover:border-slate-200 focus:border-lime-500 focus:bg-white dark:focus:bg-slate-800 rounded px-1 py-0.5 outline-none text-slate-900 dark:text-slate-100 transition-colors"
                            title="Click to edit total amount (auto-calculates quantity)"
                          />
                        </div>
                        {lineDiscount > 0 && (
                          <span className="text-[9px] text-emerald-600 dark:text-emerald-400 font-medium font-mono block text-right mt-0.5" title="Total line savings">
                            Save Rs {lineDiscount.toFixed(0)}
                          </span>
                        )}
                      </td>

                      <td className="py-2.5 px-1 text-center">
                        <button aria-label="Remove item" 
                          type="button"
                          onClick={() => setCart(cart.filter(c => c.cartItemId !== item.cartItemId))} 
                          className="text-slate-300 hover:text-red-500 p-1.5 rounded-md hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors inline-flex items-center justify-center cursor-pointer"
                          title="Remove item"
                        >
                          <Trash2 size={13} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        )}
      </div>
    </>
  );
};
