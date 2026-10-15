import React, { useMemo, useState } from 'react';
import {
  AlertTriangle, Archive, ArrowRight, Banknote, Boxes, Briefcase, ChefHat, Edit, Factory, Layers,
  Package, RotateCcw, Scale, ShieldAlert, ShoppingCart, Tag, Trash2, TrendingUp, Truck, X, Zap, Check,
} from 'lucide-react';
import { ItemDefinition } from '../../types';
import { formatCurrency, formatQty } from '../../lib/formatters';
import { buildQuickPreview, getQuickPresets } from '../../lib/posQuickEntry';
import { oneUnitLabel, pricePerBase, sellUnitContains, sellUnitPrice } from '../../lib/sellUnits';

export interface SellInPosEntry {
  mode: 'amount' | 'qty';
  value: string;
  variantId?: string;
}

interface Props {
  item: ItemDefinition;
  stock: number;
  variantStocks: Record<string, number>;
  allowNegativeStock: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canOpenPos: boolean;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onReactivate: () => void;
  onDeactivate: () => void;
  onSellInPos: (entry?: SellInPosEntry) => void;
}

const Section: React.FC<{ icon: React.ReactNode; title: string; aside?: React.ReactNode; children: React.ReactNode }> = ({ icon, title, aside, children }) => (
  <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5 shadow-xs">
    <div className="flex items-center justify-between gap-2 mb-3">
      <h4 className="text-[11px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-wider flex items-center gap-1.5">{icon}{title}</h4>
      {aside}
    </div>
    {children}
  </section>
);

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex items-start justify-between gap-4 py-2.5 border-b border-slate-100 dark:border-slate-800/80 last:border-0 last:pb-0 first:pt-0">
    <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 shrink-0 pt-0.5">{label}</span>
    <div className="text-xs sm:text-[13px] font-bold text-slate-800 dark:text-slate-200 text-right flex flex-wrap justify-end gap-1.5">{children}</div>
  </div>
);

export const ItemDetailView: React.FC<Props> = ({
  item, stock, variantStocks, allowNegativeStock, canEdit, canDelete, canOpenPos,
  onClose, onEdit, onDelete, onReactivate, onDeactivate, onSellInPos,
}) => {
  const isSale = Boolean(item.item_type?.includes('Sale product'));
  const rate = Number(item.selling_price) || 0;
  const cost = Number(item.cost_price) || 0;
  const looseAllowed = item.allow_loose_sale !== false;
  const qtyFirst = item.pos_primary_mode === 'qty';
  const activeVariants = (item.variants || []).filter(v => v.isActive !== false);
  const reorder = item.reorder_level || 5;
  const stockTone: 'out' | 'low' | 'ok' = stock <= 0 ? 'out' : stock <= reorder ? 'low' : 'ok';
  const stockPct = Math.max(0, Math.min(100, (stock / (reorder * 4 || 20)) * 100));
  const packsReady = activeVariants.reduce((sum, v) => sum + (Number(variantStocks[v.id]) || 0), 0);

  const [tab, setTab] = useState<'amount' | 'qty'>(qtyFirst ? 'qty' : 'amount');
  const preview = useMemo(() => buildQuickPreview(rate, item.unit, item.quick_amounts), [rate, item.unit, item.quick_amounts]);
  const packCounts = useMemo(() => getQuickPresets({ mode: 'qty', packaged: true, unit: item.unit, rate: 1 }).filter(n => n <= 10), [item.unit]);

  // Profit is shown for the unit people actually buy: loose rate, else the first priced pack.
  const profitBasis = useMemo(() => {
    if (rate > 0) return { sell: rate, cost, per: item.unit };
    const pack = activeVariants.find(v => Number(v.selling_price) > 0);
    if (pack) return { sell: Number(pack.selling_price), cost: cost * (Number(pack.quantity_in_base_unit) || 1), per: pack.name };
    return null;
  }, [rate, cost, item.unit, activeVariants]);
  const profit = profitBasis ? profitBasis.sell - profitBasis.cost : 0;
  const marginPct = profitBasis && profitBasis.sell > 0 ? (profit / profitBasis.sell) * 100 : 0;
  const markupPct = profitBasis && profitBasis.cost > 0 ? (profit / profitBasis.cost) * 100 : 0;

  const packPrices = activeVariants.map(v => Number(v.selling_price) || rate * (Number(v.quantity_in_base_unit) || 1)).filter(p => p > 0);
  const priceHeadline = rate > 0
    ? { value: formatCurrency(rate), sub: `per ${item.unit}` }
    : packPrices.length
      ? { value: Math.min(...packPrices) === Math.max(...packPrices) ? formatCurrency(packPrices[0]) : `${formatCurrency(Math.min(...packPrices))}+`, sub: activeVariants.length === 1 ? `per ${activeVariants[0].name}` : 'per pack' }
      : { value: formatCurrency(0), sub: 'not set' };

  const canSell = canOpenPos && item.isActive && isSale && (rate > 0 || packPrices.length > 0);
  const sellLabel = !isSale ? 'Not a sale product' : !item.isActive ? 'Inactive' : !canOpenPos ? 'No POS access' : !(rate > 0 || packPrices.length > 0) ? 'Set a selling rate first' : 'Sell in POS';

  const tone = {
    ok: { pill: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-400 dark:border-emerald-800/60', bar: 'bg-emerald-500', text: 'In stock' },
    low: { pill: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/50 dark:text-amber-400 dark:border-amber-800/60', bar: 'bg-amber-500', text: 'Low stock' },
    out: { pill: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/50 dark:text-rose-400 dark:border-rose-800/60', bar: 'bg-rose-500', text: 'Out of stock' },
  }[stockTone];

  const cashGroup = (
    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2" role="group" aria-label="Quick cash buttons">
      {preview.cash.map(c => (
        <button key={c.amount} type="button" disabled={!canSell || rate <= 0} onClick={() => onSellInPos({ mode: 'amount', value: String(c.amount) })}
          title={`Sell ${c.label} of ${item.name} in POS`}
          className="p-2.5 bg-white dark:bg-slate-800/90 rounded-xl border border-emerald-200 dark:border-emerald-900/50 flex flex-col items-center justify-center transition-all enabled:hover:border-emerald-500 dark:enabled:hover:border-emerald-500 enabled:hover:bg-emerald-50 dark:enabled:hover:bg-emerald-950/40 enabled:hover:-translate-y-0.5 enabled:active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer shadow-2xs">
          <span className="text-[13px] font-black font-mono text-emerald-800 dark:text-emerald-400">{c.label}</span>
          <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 mt-0.5">≈ {c.converted}</span>
        </button>
      ))}
    </div>
  );
  const qtyGroup = (
    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2" role="group" aria-label="Quick quantity buttons">
      {preview.qty.map(q => (
        <button key={q.qty} type="button" disabled={!canSell || rate <= 0} onClick={() => onSellInPos({ mode: 'qty', value: String(q.qty) })}
          title={`Sell ${q.title} of ${item.name} in POS`}
          className="p-2.5 bg-white dark:bg-slate-800/90 rounded-xl border border-lime-200 dark:border-lime-900/50 flex flex-col items-center justify-center transition-all enabled:hover:border-lime-500 dark:enabled:hover:border-lime-500 enabled:hover:bg-lime-50 dark:enabled:hover:bg-lime-950/40 enabled:hover:-translate-y-0.5 enabled:active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer shadow-2xs">
          <span className="text-[13px] font-black font-mono text-lime-800 dark:text-lime-400">{q.title}</span>
          <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 mt-0.5">{q.converted}</span>
          {q.hint && <span className="text-[9px] font-semibold text-lime-700/80 dark:text-lime-400/80">{q.hint}</span>}
        </button>
      ))}
    </div>
  );

  return (
    <div className="flex flex-col h-full min-h-0 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100">
      {/* Hero header */}
      <div className="shrink-0 border-b border-slate-100 dark:border-slate-800 bg-gradient-to-br from-lime-50/80 via-white to-white dark:from-slate-900 dark:via-slate-900 dark:to-slate-850 px-5 pt-5 pb-4 sm:px-6">
        <div className="flex items-start gap-4">
          <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-lime-500/10 dark:bg-lime-500/20 text-lime-700 dark:text-lime-400 flex items-center justify-center font-black text-2xl shrink-0 border border-lime-500/20 dark:border-lime-500/30 overflow-hidden shadow-xs">
            {item.image_url ? <img src={item.image_url} alt={item.name} className="w-full h-full object-cover" /> : item.name.charAt(0)}
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-lg sm:text-xl font-black text-slate-900 dark:text-white leading-tight break-words">{item.name}</h3>
            <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold border ${item.isActive ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-400 dark:border-emerald-800/60' : 'bg-rose-50 text-rose-600 border-rose-200 dark:bg-rose-950/50 dark:text-rose-400 dark:border-rose-800/60'}`}>
                {item.isActive ? 'Active' : 'Inactive'}
              </span>
              {item.isSystem && <span className="text-[10px] bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 px-2 py-0.5 rounded-full font-bold">System core</span>}
              <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700">{item.unit}</span>
              {(item.category.length ? item.category : ['Uncategorized']).map(c => (
                <span key={c} className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-transparent dark:border-slate-700/60">{c}</span>
              ))}
            </div>
          </div>
          <button onClick={onClose} aria-label="Close product details" className="p-2 -mr-1 -mt-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-all cursor-pointer"><X size={18} /></button>
        </div>

        <div className="flex items-center gap-2 mt-4">
          <button type="button" onClick={() => onSellInPos()} disabled={!canSell}
            className="flex-1 flex items-center justify-center gap-2 bg-lime-600 hover:bg-lime-700 dark:bg-lime-500 dark:hover:bg-lime-400 text-white dark:text-slate-950 disabled:bg-slate-200 dark:disabled:bg-slate-800 disabled:text-slate-400 dark:disabled:text-slate-600 disabled:cursor-not-allowed px-4 py-2.5 rounded-xl text-sm font-bold shadow-xs transition-all active:scale-[0.98] cursor-pointer">
            <ShoppingCart size={16} />{sellLabel}{canSell && <ArrowRight size={15} />}
          </button>
          {canEdit && (
            <button type="button" onClick={onEdit} title="Edit item details"
              className="flex items-center gap-1.5 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 px-3.5 py-2.5 rounded-xl text-sm font-bold border border-slate-200 dark:border-slate-700 transition-all active:scale-95 cursor-pointer">
              <Edit size={15} /><span className="hidden sm:inline">Edit</span>
            </button>
          )}
          {!item.isActive ? (
            <button type="button" onClick={onReactivate} title="Reactivate product"
              className="flex items-center gap-1.5 bg-amber-50 dark:bg-amber-950/40 hover:bg-amber-100 dark:hover:bg-amber-900/40 text-amber-800 dark:text-amber-300 px-3.5 py-2.5 rounded-xl text-sm font-bold border border-amber-200 dark:border-amber-800/60 transition-all active:scale-95 cursor-pointer">
              <RotateCcw size={15} /><span className="hidden sm:inline">Reactivate</span>
            </button>
          ) : item.isSystem ? (
            <button type="button" onClick={onDeactivate} title="Deactivate product"
              className="flex items-center gap-1.5 bg-white dark:bg-slate-800 hover:bg-rose-50 dark:hover:bg-rose-950/30 text-slate-600 dark:text-slate-300 hover:text-rose-700 dark:hover:text-rose-400 px-3.5 py-2.5 rounded-xl text-sm font-bold border border-slate-200 dark:border-slate-700 hover:border-rose-200 dark:hover:border-rose-900 transition-all active:scale-95 cursor-pointer">
              <Archive size={15} /><span className="hidden sm:inline">Deactivate</span>
            </button>
          ) : null}
          {canDelete && !item.isSystem && (
            <button type="button" onClick={onDelete} title="Delete product"
              className="p-2.5 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 border border-slate-200 dark:border-slate-700 hover:border-rose-200 dark:hover:border-rose-900 rounded-xl transition-all cursor-pointer"><Trash2 size={16} /></button>
          )}
        </div>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 min-h-0 overflow-y-auto p-5 sm:p-6 space-y-4 bg-slate-50/50 dark:bg-slate-950">
        {/* Key numbers */}
        <div className="grid grid-cols-2 gap-2.5 sm:gap-3">
          <div className="bg-white dark:bg-slate-900 p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider flex items-center gap-1"><Package size={11} className="text-blue-500" />In stock</span>
              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border ${tone.pill}`}>{tone.text}</span>
            </div>
            <div className="mt-1.5 flex items-baseline gap-1">
              <span className="text-xl font-black text-slate-900 dark:text-white font-mono">{formatQty(stock)}</span>
              <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase">{item.unit}</span>
            </div>
            <div className="mt-2 h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden" aria-hidden="true"><div className={`h-full rounded-full ${tone.bar}`} style={{ width: `${stockPct}%` }} /></div>
            <span className="text-[10px] text-slate-500 dark:text-slate-400 font-semibold mt-1.5 block">
              {activeVariants.length > 0 ? `${formatQty(packsReady)} packs ready · ` : ''}reorder at {formatQty(reorder)}
            </span>
          </div>

          <div className="bg-white dark:bg-slate-900 p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
            <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider flex items-center gap-1"><Tag size={11} className="text-emerald-500" />Selling price</span>
            <div className="mt-1.5"><span className="text-xl font-black text-slate-900 dark:text-white font-mono">{priceHeadline.value}</span></div>
            <span className="text-[10px] text-slate-500 dark:text-slate-400 font-semibold mt-1 block">{priceHeadline.sub}</span>
          </div>

          <div className="bg-white dark:bg-slate-900 p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
            <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider flex items-center gap-1"><Briefcase size={11} className="text-slate-400" />Landed cost</span>
            <div className="mt-1.5"><span className="text-xl font-black text-slate-700 dark:text-slate-300 font-mono">{formatCurrency(cost)}</span></div>
            <span className="text-[10px] text-slate-500 dark:text-slate-400 font-semibold mt-1 block">per {item.unit}</span>
          </div>

          <div className="bg-white dark:bg-slate-900 p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
            <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider flex items-center gap-1"><TrendingUp size={11} className="text-emerald-500" />Profit</span>
            {profitBasis ? (
              <>
                <div className="mt-1.5"><span className={`text-xl font-black font-mono ${profit >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>{profit >= 0 ? '+' : ''}{formatCurrency(profit)}</span></div>
                <span className="text-[10px] text-slate-500 dark:text-slate-400 font-semibold mt-1 block">{marginPct.toFixed(1)}% margin · {markupPct.toFixed(0)}% markup <span className="text-slate-500 dark:text-slate-400">/ {profitBasis.per}</span></span>
              </>
            ) : (
              <>
                <div className="mt-1.5"><span className="text-xl font-black text-slate-300 dark:text-slate-600 font-mono">N/A</span></div>
                <span className="text-[10px] text-slate-500 dark:text-slate-400 font-semibold mt-1 block">Needs a selling price</span>
              </>
            )}
          </div>
        </div>

        {/* POS quick sell */}
        {isSale && (
          <section className="rounded-2xl border border-lime-200/90 dark:border-lime-500/20 bg-gradient-to-br from-lime-50/80 via-white to-emerald-50/40 dark:from-slate-900 dark:via-slate-900 dark:to-slate-850 p-4 sm:p-5 shadow-xs space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <h4 className="text-[11px] font-black text-slate-800 dark:text-slate-200 uppercase tracking-wider flex items-center gap-1.5"><Zap size={14} className="text-lime-600 dark:text-lime-400" />Quick sell in POS</h4>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium mt-0.5">Same buttons the cashier sees. Tap one to open POS with it ready.</p>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="pos-sort-badge text-[10px] px-2.5 py-1" title="Position in the POS product grid">{item.sort_order === 1 ? 'Grid #1' : `Grid #${item.sort_order ?? 999}`}</span>
                <span className={`text-[10px] font-bold px-2.5 py-1 rounded-lg border ${qtyFirst ? 'bg-lime-100 text-lime-800 border-lime-300 dark:bg-lime-950/50 dark:text-lime-300 dark:border-lime-800/60' : 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800/60'}`} title="Which entry mode the POS dialog opens with">
                  Opens with {looseAllowed ? (qtyFirst ? 'Quantity' : 'Cash') : 'Packs'}
                </span>
              </div>
            </div>

            {looseAllowed && rate > 0 && (
              <div>
                <div className="grid grid-cols-2 p-1 rounded-xl bg-slate-100 dark:bg-slate-800 gap-1 mb-3" role="tablist" aria-label="Quick button type">
                  {(qtyFirst ? ['qty', 'amount'] as const : ['amount', 'qty'] as const).map(key => (
                    <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}
                      className={`flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${tab === key ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}>
                      {key === 'amount' ? <Banknote size={14} className="text-emerald-600 dark:text-emerald-400" /> : <Scale size={14} className="text-lime-600 dark:text-lime-400" />}
                      {key === 'amount' ? 'Cash' : 'Quantity'}
                      {key === 'amount' && <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${preview.usingDefaultCash ? 'bg-slate-200 dark:bg-slate-800 text-slate-500 dark:text-slate-400' : 'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300'}`}>{preview.usingDefaultCash ? 'auto' : 'custom'}</span>}
                    </button>
                  ))}
                </div>
                {tab === 'amount' ? cashGroup : qtyGroup}
                {tab === 'amount' && preview.usingDefaultCash && (
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 font-medium mt-2">Auto amounts based on the rate. Use Edit → POS Quick Cash Buttons to set your own.</p>
                )}
              </div>
            )}

            {looseAllowed && rate <= 0 && (
              <p className="flex items-center gap-2 text-[11px] font-bold text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 rounded-lg px-3 py-2">
                <AlertTriangle size={14} className="shrink-0" />Set a loose selling rate to enable cash and quantity buttons.
              </p>
            )}

            {!looseAllowed && (
              <p className="flex items-center gap-2 text-[11px] font-semibold text-slate-600 dark:text-slate-400 bg-white/80 dark:bg-slate-800/80 border border-dashed border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2">
                <Boxes size={14} className="shrink-0 text-indigo-500 dark:text-indigo-400" />Sold by pack only. Use the pack buttons below.
              </p>
            )}

            {activeVariants.length > 0 && (
              <div className="space-y-2.5">
                <span className="text-[11px] font-bold text-indigo-900 dark:text-indigo-400 uppercase tracking-wider flex items-center gap-1.5"><Boxes size={13} className="text-indigo-600 dark:text-indigo-400" />Sell units</span>
                {looseAllowed && (
                  <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2.5 flex items-center justify-between gap-3">
                    <div>
                      <span className="font-bold text-slate-900 dark:text-white text-sm block">1 {item.unit}</span>
                      <span className="text-[11px] text-slate-500 dark:text-slate-400">Loose · main stock</span>
                    </div>
                    <div className="text-right">
                      <span className="font-mono font-black text-slate-900 dark:text-white text-sm block">{rate > 0 ? formatCurrency(rate) : 'No price'}</span>
                      <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400">{formatQty(stock)} {item.unit} in stock</span>
                    </div>
                  </div>
                )}
                {activeVariants.map(v => {
                  const contains = sellUnitContains(v);
                  const price = sellUnitPrice(rate, contains, v.selling_price);
                  const each = pricePerBase(price, contains);
                  const fromBase = v.deduct_from_base === true;
                  const ready = fromBase ? (contains > 0 ? stock / contains : 0) : (Number(variantStocks[v.id]) || 0);
                  const differs = rate > 0 && Math.abs(each - rate) > 0.009;
                  const vOut = ready <= 0 && !allowNegativeStock;
                  return (
                    <div key={v.id} className="rounded-xl border border-indigo-100 dark:border-indigo-950/60 bg-white dark:bg-slate-900 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold text-slate-900 dark:text-white text-sm truncate">{oneUnitLabel(v.name, contains, item.unit)}</span>
                            {fromBase ? (
                              <span className="text-[9px] bg-indigo-100 text-indigo-700 dark:bg-indigo-950/80 dark:text-indigo-300 px-1.5 py-0.2 rounded font-bold uppercase tracking-wider">
                                Multi-Unit
                              </span>
                            ) : (
                              <span className="text-[9px] bg-amber-100 text-amber-800 dark:bg-amber-950/80 dark:text-amber-300 px-1.5 py-0.2 rounded font-bold uppercase tracking-wider">
                                Packaged Stock
                              </span>
                            )}
                          </div>
                          <span className="text-[11px] text-slate-500 dark:text-slate-400 block mt-0.5">
                            {formatCurrency(each)}/{item.unit}
                            {differs ? ` · loose ${formatCurrency(rate)}/${item.unit}` : ''}
                            {fromBase ? ' · shares main stock pool' : (v.packaging_item_name ? ` · ${formatQty(v.packaging_qty)}× ${v.packaging_item_name}` : ' · independent shelf stock')}
                          </span>
                        </div>
                        <div className="text-right shrink-0">
                          <span className="font-mono font-black text-slate-900 dark:text-white text-sm block">{price > 0 ? formatCurrency(price) : 'No price'}</span>
                          <span className={`text-[10px] font-bold ${ready <= 0 ? 'text-rose-600 dark:text-rose-400' : ready <= 5 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                            {ready <= 0 ? 'Out of stock' : fromBase ? `${formatQty(ready, 1)} ${v.name} available` : `${formatQty(ready)} ${v.name} in stock`}
                          </span>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1.5 mt-2.5">
                        {packCounts.map(n => {
                          const disabled = !canSell || price <= 0 || vOut || (!allowNegativeStock && n > ready + 0.001);
                          return (
                            <button key={n} type="button" disabled={disabled} onClick={() => onSellInPos({ mode: 'qty', value: String(n), variantId: v.id })}
                              title={`Sell ${n} ${v.name} = ${formatQty(n * contains, 3)} ${item.unit}`}
                              className="min-w-[3.25rem] px-2.5 py-1.5 rounded-lg border border-indigo-200 dark:border-indigo-800/60 bg-indigo-50/50 dark:bg-indigo-950/40 text-center transition-all enabled:hover:bg-indigo-100 dark:enabled:hover:bg-indigo-900/40 enabled:hover:border-indigo-400 enabled:active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer">
                              <span className="text-xs font-black text-indigo-800 dark:text-indigo-300 block">{n} {v.name}</span>
                              <span className="text-[9px] font-bold text-slate-500 dark:text-slate-400 block">{formatCurrency(price * n)}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {/* Details */}
        <Section icon={<Layers size={13} className="text-slate-500 dark:text-slate-400" />} title="Details">
          <Row label="Used as">
            {item.item_type.map(t => (
              <span key={t} className={`px-2 py-0.5 rounded-lg text-[11px] font-bold border ${t === 'Sale product' ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-400 dark:border-emerald-800/60' : t === 'Raw material' ? 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/50 dark:text-amber-400 dark:border-amber-800/60' : 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/50 dark:text-blue-400 dark:border-blue-800/60'}`}>{t}</span>
            ))}
          </Row>
          <Row label="Sourcing">
            {item.source === 'Supplier' && <Truck size={14} className="text-blue-500" />}
            {item.source === 'Production' && <Factory size={14} className="text-amber-500" />}
            {(!item.source || item.source === 'Both') && <Briefcase size={14} className="text-emerald-500" />}
            <span>{item.source === 'Supplier' ? 'Vendor / purchase' : item.source === 'Production' ? 'In-house production' : 'Purchase or production'}</span>
          </Row>
          <Row label="Sale policy">
            {looseAllowed
              ? <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400"><Check size={13} />Loose and packs</span>
              : <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400"><ShieldAlert size={13} />Packs only</span>}
          </Row>
          <Row label="Reorder level">{formatQty(reorder)} {item.unit}</Row>
        </Section>

        {/* Recipe */}
        {item.recipe && item.recipe.length > 0 && (
          <Section
            icon={<ChefHat size={14} className="text-amber-600 dark:text-amber-400" />}
            title="Recipe & bill of materials"
            aside={item.recipe_base_quantity ? <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400">{formatQty(item.recipe_base_quantity)} L milk → {formatQty(item.recipe_expected_output || 0)} {item.unit}</span> : undefined}
          >
            <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800 text-xs">
              {item.recipe.map((ing, idx) => (
                <div key={idx} className="p-2.5 bg-white dark:bg-slate-900 flex items-center justify-between">
                  <span className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                    <span className="w-5 h-5 rounded bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400 text-[10px] font-bold flex items-center justify-center">{idx + 1}</span>
                    {ing.item_name}
                  </span>
                  <span className="font-mono font-bold text-slate-700 dark:text-slate-300">{formatQty(ing.quantity)} {ing.unit}</span>
                </div>
              ))}
            </div>
          </Section>
        )}
      </div>
    </div>
  );
};
