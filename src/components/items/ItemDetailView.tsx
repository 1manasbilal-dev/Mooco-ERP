import React, { useMemo, useState } from 'react';
import {
  AlertTriangle, Archive, ArrowRight, Banknote, Boxes, Briefcase, ChefHat, Factory, PackagePlus, Pencil, RotateCcw, Scale,
  ShoppingCart, Trash2, Truck, X, Zap,
} from 'lucide-react';
import type { ItemDefinition } from '../../types';
import { Badge, Button, IconButton, Money, SegmentedControl } from '../ui';
import type { Tone } from '../ui';
import { cn } from '../../lib/cn';
import { formatCurrency, formatQty } from '../../lib/formatters';
import { buildQuickPreview, getQuickPresets } from '../../lib/posQuickEntry';
import { availableSellUnits, oneUnitLabel, pricePerBase, sellUnitContains, sellUnitPrice } from '../../lib/sellUnits';
import { STOCK_STATUS_LABEL, formatBaseQty, readStock } from '../../lib/stockRules';
import { profitBasisFor, profitOf, stockAlert } from './catalogModel';
import { ProductThumb } from './ProductThumb';

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
  /** True for a saved product with no stock yet and no stock history: it can still take opening stock. */
  canSetOpeningStock?: boolean;
  /** Opens the edit form, where the opening stock is entered. */
  onOpeningStock?: () => void;
  /** Current catalog name for a recipe material, so renamed materials don't show their old name. */
  materialName?: (itemId: string) => string | undefined;
  /** id for the product name heading, so the surrounding sheet can use it as its label. */
  titleId?: string;
}

const STOCK_LOOK: Record<'ok' | 'low' | 'out' | 'minus' | 'inactive', { tone: Tone; bar: string }> = {
  ok: { tone: 'success', bar: 'bg-success' },
  low: { tone: 'warning', bar: 'bg-warning' },
  out: { tone: 'danger', bar: 'bg-danger' },
  minus: { tone: 'danger', bar: 'bg-danger' },
  inactive: { tone: 'neutral', bar: 'bg-fg-faint' },
};

const TYPE_TONE: Record<string, Tone> = { 'Sale product': 'success', 'Raw material': 'warning', 'Packaging material': 'info' };

function Section({ icon, title, aside, children }: { icon: React.ReactNode; title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-card border border-line bg-surface p-4 shadow-e1 sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h4 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg-subtle [&_svg]:size-3.5">{icon}{title}</h4>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line/70 py-2.5 first:pt-0 last:border-0 last:pb-0">
      <span className="shrink-0 pt-0.5 text-xs font-semibold text-fg-subtle">{label}</span>
      <div className="flex flex-wrap justify-end gap-1.5 text-right text-[13px] font-semibold text-fg">{children}</div>
    </div>
  );
}

function Metric({ label, value, sub, children }: { label: string; value: React.ReactNode; sub?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="rounded-card border border-line bg-surface p-3.5 shadow-e1">
      <span className="text-xs font-semibold text-fg-subtle">{label}</span>
      <div className="mt-1 text-xl font-bold leading-tight tracking-tight tabular-nums text-fg">{value}</div>
      {sub && <div className="mt-1 text-[11px] text-fg-subtle">{sub}</div>}
      {children}
    </div>
  );
}

/** Read-only product page: stock by pile, prices, profit, quick POS buttons and warnings. */
export const ItemDetailView: React.FC<Props> = ({
  item, stock, variantStocks, allowNegativeStock, canEdit, canDelete, canOpenPos,
  onClose, onEdit, onDelete, onReactivate, onDeactivate, onSellInPos, canSetOpeningStock, onOpeningStock, materialName, titleId,
}) => {
  const isSale = Boolean(item.item_type?.includes('Sale product'));
  const rate = Number(item.selling_price) || 0;
  const cost = Number(item.cost_price) || 0;
  const looseAllowed = item.allow_loose_sale !== false;
  const qtyFirst = item.pos_primary_mode === 'qty';
  const activeVariants = useMemo(() => (item.variants || []).filter(v => v.isActive !== false), [item.variants]);
  // One reading for the whole page (docs/stock-model.md): piles, totals, value, status and warnings.
  const reading = useMemo(() => readStock(item, stock, variantStocks), [item, stock, variantStocks]);
  const reorder = reading.reorderLevel;
  const alert = stockAlert(reading, item.isActive !== false);
  const look = STOCK_LOOK[item.isActive === false ? 'inactive' : alert || 'ok'];
  const statusText = item.isActive === false ? 'Inactive' : STOCK_STATUS_LABEL[reading.status];
  // The bar fills up to four times the alert level; without an alert level it only says "something" or "nothing".
  const stockPct = reorder > 0
    ? Math.max(0, Math.min(100, (reading.totalBase / (reorder * 4)) * 100))
    : reading.totalBase > 0 ? 100 : 0;
  const hasPacks = reading.piles.some(p => (p.kind === 'packed' || p.kind === 'orphan') && p.count !== 0);
  const sellableDiffers = isSale && Math.abs(reading.sellableBase - reading.totalBase) > 0.0005;

  const [tab, setTab] = useState<'amount' | 'qty'>(qtyFirst ? 'qty' : 'amount');
  const preview = useMemo(() => buildQuickPreview(rate, item.unit, item.quick_amounts), [rate, item.unit, item.quick_amounts]);
  const packCounts = useMemo(() => getQuickPresets({ mode: 'qty', packaged: true, unit: item.unit, rate: 1 }).filter(n => n <= 10), [item.unit]);

  // Profit is shown for the unit people actually buy (same rule as the catalog list).
  const profitBasis = useMemo(() => profitBasisFor(item), [item]);
  const { profit, marginPct, markupPct } = profitOf(profitBasis);
  const looseRate = looseAllowed ? rate : 0;

  const packPrices = activeVariants.map(v => sellUnitPrice(rate, sellUnitContains(v), v.selling_price)).filter(p => p > 0);
  const minPack = packPrices.length ? Math.min(...packPrices) : 0;
  const maxPack = packPrices.length ? Math.max(...packPrices) : 0;
  const priceHeadline = looseRate > 0
    ? { value: <Money amount={looseRate} />, sub: `per ${item.unit}` }
    : packPrices.length
      ? { value: <>{<Money amount={minPack} />}{minPack !== maxPack ? '+' : ''}</>, sub: activeVariants.length === 1 ? `per ${activeVariants[0].name}` : 'per pack' }
      : { value: <span className="text-fg-faint">—</span>, sub: 'No rate set' };

  const canSell = canOpenPos && item.isActive && isSale && (rate > 0 || packPrices.length > 0);
  const sellLabel = !isSale ? 'Not a sale product' : !item.isActive ? 'Inactive' : !canOpenPos ? 'No POS permission' : !(rate > 0 || packPrices.length > 0) ? 'Set a rate first' : 'Sell in POS';

  const quickButton = 'flex flex-col items-center justify-center rounded-control border border-line bg-surface p-2.5 text-center transition-[border-color,background-color,transform] duration-150 enabled:cursor-pointer enabled:hover:border-brand-accent enabled:hover:bg-brand-soft/60 enabled:active:scale-[.97] disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

  return (
    <div className="flex h-full min-h-0 flex-col bg-canvas text-fg">
      <div className="shrink-0 border-b border-line bg-surface px-4 pb-4 pt-4 sm:px-6 sm:pt-5">
        <div className="flex items-start gap-4">
          <ProductThumb name={item.name} src={item.image_url} dimmed={!item.isActive} className="size-16 rounded-2xl sm:size-20" initialsClassName="text-xl" />
          <div className="min-w-0 flex-1">
            <h3 id={titleId} className="break-words text-xl font-bold leading-tight tracking-tight text-fg">{item.name}</h3>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <Badge tone={item.isActive ? 'success' : 'neutral'} dot>{item.isActive ? 'Active' : 'Inactive'}</Badge>
              {item.isSystem && <Badge tone="info">System core</Badge>}
              <Badge tone="neutral">{item.unit}</Badge>
              {(item.category.length ? item.category : ['Uncategorized']).map(c => <Badge key={c} tone="neutral">{c}</Badge>)}
            </div>
          </div>
          <IconButton aria-label="Close product details" icon={<X />} onClick={onClose} className="-mr-1 -mt-1" />
        </div>

        <div className="mt-4 flex items-center gap-2">
          <Button className="flex-1" leftIcon={<ShoppingCart />} rightIcon={canSell ? <ArrowRight /> : undefined} onClick={() => onSellInPos()} disabled={!canSell}>
            {sellLabel}
          </Button>
          {canEdit && <Button variant="secondary" leftIcon={<Pencil />} onClick={onEdit} aria-label="Edit product"><span className="hidden sm:inline">Edit</span></Button>}
          {(canEdit || canDelete) && !item.isActive && (
            <Button variant="soft" leftIcon={<RotateCcw />} onClick={onReactivate} aria-label="Reactivate product"><span className="hidden sm:inline">Reactivate</span></Button>
          )}
          {canDelete && item.isActive && item.isSystem && (
            <Button variant="secondary" leftIcon={<Archive />} onClick={onDeactivate} aria-label="Deactivate product"><span className="hidden sm:inline">Deactivate</span></Button>
          )}
          {canDelete && !item.isSystem && (
            <IconButton variant="secondary" aria-label="Delete product" icon={<Trash2 />} className="hover:bg-danger-soft hover:text-danger-fg" onClick={onDelete} />
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 sm:p-6">
        <div className="grid grid-cols-2 gap-3">
          <Metric
            label="Stock"
            value={<>{formatQty(reading.totalBase, 3)} <span className="text-xs font-semibold text-fg-subtle">{item.unit}</span></>}
            sub={<>
              {hasPacks && <span className="block">Loose + packs (each pile below)</span>}
              {sellableDiffers && <span className="block">{formatBaseQty(reading.sellableBase, item.unit)} can be sold</span>}
              <span className="block">{reorder > 0 ? `Alert at ${formatBaseQty(reorder, item.unit)}` : 'Low-stock alert off'}</span>
            </>}
          >
            <div className="mt-2 flex items-center gap-2">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3" aria-hidden="true">
                <div className={cn('h-full rounded-full', look.bar)} style={{ width: `${stockPct}%` }} />
              </div>
              <Badge tone={look.tone}>{statusText}</Badge>
            </div>
          </Metric>
          <Metric label="Selling price" value={priceHeadline.value} sub={priceHeadline.sub} />
          <Metric label="Landed cost" value={<Money amount={cost} />} sub={`per ${item.unit}`} />
          <Metric
            label="Profit"
            value={profitBasis
              ? <span className={profit < 0 ? 'text-danger-fg' : 'text-success-fg'}>{profit >= 0 ? '+' : '-'}{formatCurrency(Math.abs(profit))}</span>
              : <span className="text-fg-faint">—</span>}
            sub={profitBasis
              ? <>{marginPct !== null ? `${marginPct.toFixed(1)}% margin` : ''}{markupPct !== null ? ` · ${markupPct.toFixed(0)}% markup` : ''} / {profitBasis.per}</>
              : 'Needs a selling price'}
          />
        </div>

        <Section icon={<Boxes />} title="Stock by unit" aside={<span className="text-xs text-fg-subtle"><Money amount={reading.costValue} className="font-semibold text-fg-muted" /> at cost</span>}>
          <div className="divide-y divide-line/70 overflow-hidden rounded-control border border-line text-sm">
            {reading.piles.map(pile => (
              <div key={pile.id} className={cn('flex items-center justify-between gap-3 px-3 py-2.5', !(pile.isActive || pile.kind === 'loose') && 'opacity-60', pile.kind === 'orphan' && 'opacity-100 bg-warning-soft/50')}>
                <div className="min-w-0">
                  <span className="block truncate font-semibold text-fg">
                    {pile.kind === 'loose' ? `Loose (${item.unit})` : `${pile.name} · ${formatBaseQty(pile.contains, item.unit)}`}
                  </span>
                  <span className="text-[11px] text-fg-subtle">
                    {pile.kind === 'loose' && (looseAllowed ? 'Base stock' : 'Base stock · loose sale off')}
                    {pile.kind === 'multi' && `Multi-unit · taken from loose, no count of its own`}
                    {pile.kind === 'packed' && (pile.isActive ? 'Ready-made pack · own count' : 'Ready-made pack · hidden: not in POS, stock is still here')}
                    {pile.kind === 'orphan' && 'Old count: belongs to no pack. Set it to 0 in Inventory stock count.'}
                  </span>
                </div>
                <div className="shrink-0 text-right">
                  <span className={cn('block font-bold tabular-nums', pile.count < 0 ? 'text-danger-fg' : 'text-fg')}>
                    {pile.kind === 'loose' && formatBaseQty(pile.count, item.unit)}
                    {pile.kind === 'multi' && `≈ ${formatQty(Math.floor(pile.count * 100) / 100, 2)} ${pile.name}`}
                    {(pile.kind === 'packed' || pile.kind === 'orphan') && `${formatQty(pile.count, 3)} ×`}
                  </span>
                  {pile.kind === 'packed' && <span className="text-[11px] text-fg-subtle">= {formatBaseQty(pile.baseQty, item.unit)}</span>}
                </div>
              </div>
            ))}
            <div className="flex items-center justify-between bg-surface-2 px-3 py-2.5 text-xs font-bold text-fg-muted">
              <span>Total on hand{reading.hiddenPacks.length > 0 ? ' (incl. hidden packs)' : ''}</span>
              <span className="tabular-nums">{formatBaseQty(reading.totalBase, item.unit)}</span>
            </div>
          </div>
          {canSetOpeningStock && onOpeningStock && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-control border border-dashed border-line-strong px-3 py-2.5">
              <p className="min-w-0 flex-1 text-xs text-fg-muted">No stock or stock record yet. If the shop already has stock, enter the opening stock.</p>
              <Button size="sm" variant="secondary" leftIcon={<PackagePlus />} onClick={onOpeningStock}>Opening stock</Button>
            </div>
          )}
          {reading.warnings.length > 0 && (
            <ul className="mt-3 space-y-1 rounded-control bg-warning-soft px-3 py-2.5" aria-label="Product warnings">
              {reading.warnings.map(w => (
                <li key={w} className="flex items-start gap-1.5 text-xs font-medium text-warning-fg">
                  <AlertTriangle className="mt-0.5 size-3 shrink-0" />{w}
                </li>
              ))}
            </ul>
          )}
        </Section>

        {isSale && (
          <Section
            icon={<Zap />}
            title="Quick sell in POS"
            aside={
              <div className="flex items-center gap-1.5">
                <Badge tone="brand" className="font-mono" title="Position in the POS grid">#{item.sort_order ?? 999}</Badge>
                <Badge tone="neutral" title="The POS dialog opens in this mode">{looseAllowed ? (qtyFirst ? 'Quantity first' : 'Cash first') : 'Packs'}</Badge>
              </div>
            }
          >
            <p className="-mt-1 mb-3 text-xs text-fg-subtle">The same buttons the cashier sees. Tap one to open the POS with that entry.</p>

            {looseAllowed && rate > 0 && (
              <div className="space-y-3">
                <SegmentedControl
                  aria-label="Quick button type"
                  size="sm"
                  fullWidth
                  value={tab}
                  onChange={setTab}
                  options={(qtyFirst ? ['qty', 'amount'] as const : ['amount', 'qty'] as const).map(key => ({
                    value: key,
                    label: key === 'amount' ? `Cash${preview.usingDefaultCash ? ' (auto)' : ''}` : 'Quantity',
                    icon: key === 'amount' ? <Banknote /> : <Scale />,
                  }))}
                />
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4" role="group" aria-label={tab === 'amount' ? 'Quick cash buttons' : 'Quick quantity buttons'}>
                  {tab === 'amount'
                    ? preview.cash.map(c => (
                      <button key={c.amount} type="button" disabled={!canSell} onClick={() => onSellInPos({ mode: 'amount', value: String(c.amount) })}
                        title={`${item.name}: ${c.label} in POS`} className={quickButton}>
                        <span className="text-[13px] font-bold tabular-nums text-fg">{c.label}</span>
                        <span className="mt-0.5 text-[11px] text-fg-subtle">≈ {c.converted}</span>
                      </button>
                    ))
                    : preview.qty.map(q => (
                      <button key={q.qty} type="button" disabled={!canSell} onClick={() => onSellInPos({ mode: 'qty', value: String(q.qty) })}
                        title={`${item.name}: ${q.title} in POS`} className={quickButton}>
                        <span className="text-[13px] font-bold tabular-nums text-fg">{q.title}</span>
                        <span className="mt-0.5 text-[11px] text-fg-subtle">{q.converted}</span>
                        {q.hint && <span className="text-[10px] font-semibold text-brand-fg">{q.hint}</span>}
                      </button>
                    ))}
                </div>
                {tab === 'amount' && preview.usingDefaultCash && (
                  <p className="text-[11px] text-fg-subtle">Auto amounts from the rate. For your own amounts: Edit → POS setup → Quick cash buttons.</p>
                )}
              </div>
            )}

            {looseAllowed && rate <= 0 && (
              <p className="flex items-center gap-2 rounded-control bg-warning-soft px-3 py-2 text-xs font-semibold text-warning-fg">
                <AlertTriangle className="size-3.5 shrink-0" />Set a loose selling rate to get cash and quantity buttons.
              </p>
            )}

            {!looseAllowed && (
              <p className="flex items-center gap-2 rounded-control border border-dashed border-line-strong px-3 py-2 text-xs font-medium text-fg-muted">
                <Boxes className="size-3.5 shrink-0" />Sold in packs only. Use the pack buttons below.
              </p>
            )}

            {activeVariants.length > 0 && (
              <div className="mt-4 space-y-2.5">
                <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg-subtle"><Boxes className="size-3.5" />Sell units</span>
                {looseAllowed && (
                  <div className="flex items-center justify-between gap-3 rounded-control border border-line px-3 py-2.5">
                    <div>
                      <span className="block text-sm font-semibold text-fg">1 {item.unit}</span>
                      <span className="text-[11px] text-fg-subtle">Loose · main stock</span>
                    </div>
                    <div className="text-right">
                      <span className="block text-sm font-bold tabular-nums text-fg">{rate > 0 ? formatCurrency(rate) : 'No price'}</span>
                      <span className="text-[11px] text-fg-subtle">{formatBaseQty(stock, item.unit)} stock</span>
                    </div>
                  </div>
                )}
                {activeVariants.map(v => {
                  const contains = sellUnitContains(v);
                  const price = sellUnitPrice(rate, contains, v.selling_price);
                  const each = pricePerBase(price, contains);
                  const fromBase = v.deduct_from_base === true;
                  // Same rule as the POS: a multi-unit divides loose stock, a ready-made pack has its own count.
                  const ready = availableSellUnits(stock, Number(variantStocks[v.id]) || 0, v);
                  const differs = rate > 0 && Math.abs(each - rate) > 0.009;
                  const vOut = ready <= 0 && !allowNegativeStock;
                  return (
                    <div key={v.id} className="rounded-control border border-line p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="truncate text-sm font-semibold text-fg">{oneUnitLabel(v.name, contains, item.unit)}</span>
                            {fromBase ? <Badge tone="info">From loose</Badge> : <Badge tone="warning">Ready-made pack</Badge>}
                          </div>
                          <span className="mt-0.5 block text-xs text-fg-subtle">
                            {formatCurrency(each)}/{item.unit}
                            {differs ? ` · loose ${formatCurrency(rate)}/${item.unit}` : ''}
                            {fromBase ? ' · taken from loose stock' : (v.packaging_item_name ? ` · ${formatQty(v.packaging_qty)}× ${v.packaging_item_name}` : ' · own count')}
                          </span>
                        </div>
                        <div className="shrink-0 text-right">
                          <span className="block text-sm font-bold tabular-nums text-fg">{price > 0 ? formatCurrency(price) : 'No price'}</span>
                          <span className={cn('text-[11px] font-semibold', ready <= 0 ? 'text-danger-fg' : alert === 'low' ? 'text-warning-fg' : 'text-success-fg')}>
                            {ready <= 0 ? 'Out of stock' : fromBase ? `${formatQty(Math.floor(ready * 10) / 10, 1)} ${v.name} can be made` : `${formatQty(ready, 3)} ${v.name} in stock`}
                          </span>
                        </div>
                      </div>
                      <div className="mt-2.5 flex flex-wrap gap-1.5">
                        {packCounts.map(n => {
                          const disabled = !canSell || price <= 0 || vOut || (!allowNegativeStock && n > ready + 0.001);
                          return (
                            <button key={n} type="button" disabled={disabled} onClick={() => onSellInPos({ mode: 'qty', value: String(n), variantId: v.id })}
                              title={`${n} ${v.name} = ${formatQty(n * contains, 3)} ${item.unit}`}
                              className={cn(quickButton, 'min-w-[3.5rem] px-2.5 py-1.5')}>
                              <span className="text-xs font-bold text-fg">{n} {v.name}</span>
                              <span className="text-[11px] tabular-nums text-fg-subtle">{formatCurrency(price * n)}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Section>
        )}

        <Section icon={<Briefcase />} title="Details">
          <Row label="Used as">
            {item.item_type.map(t => <Badge key={t} tone={TYPE_TONE[t] || 'neutral'}>{t}</Badge>)}
          </Row>
          <Row label="Sourcing">
            <span className="inline-flex items-center gap-1.5 [&_svg]:size-3.5 [&_svg]:text-fg-subtle">
              {item.source === 'Supplier' ? <Truck /> : item.source === 'Production' ? <Factory /> : <Briefcase />}
              {item.source === 'Supplier' ? 'Bought from vendor' : item.source === 'Production' ? 'In-house production' : 'Purchase or production'}
            </span>
          </Row>
          <Row label="Sale policy">
            {looseAllowed ? <Badge tone="success">Loose and packs</Badge> : <Badge tone="warning">Packs only</Badge>}
          </Row>
          <Row label="Low stock alert">{reorder > 0 ? `${formatBaseQty(reorder, item.unit)} (total stock)` : <span className="text-fg-subtle">Off (0)</span>}</Row>
        </Section>

        {item.recipe && item.recipe.length > 0 && (
          <Section
            icon={<ChefHat />}
            title="Recipe"
            aside={item.recipe_base_quantity ? (
              <span className="text-[11px] font-semibold text-fg-subtle">
                {formatQty(item.recipe_base_quantity)} {item.recipe_base_item_id && item.recipe_base_item_id !== 'MILK_BASE' ? (materialName?.(item.recipe_base_item_id) || 'base') : 'L milk'} → {formatQty(item.recipe_expected_output || 0)} {item.unit}
              </span>
            ) : undefined}
          >
            <ol className="divide-y divide-line/70 overflow-hidden rounded-control border border-line text-sm">
              {item.recipe.map((ing, idx) => (
                <li key={`${ing.item_id}-${idx}`} className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <span className="flex min-w-0 items-center gap-2 font-semibold text-fg">
                    <span className="flex size-5 shrink-0 items-center justify-center rounded bg-surface-2 text-[10px] font-bold text-fg-muted">{idx + 1}</span>
                    <span className="truncate">{materialName?.(ing.item_id) || ing.item_name}</span>
                  </span>
                  <span className="shrink-0 font-semibold tabular-nums text-fg-muted">{formatQty(ing.quantity)} {ing.unit}</span>
                </li>
              ))}
            </ol>
          </Section>
        )}
      </div>
    </div>
  );
};
