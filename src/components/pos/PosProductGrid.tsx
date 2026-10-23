import React, { memo, useRef, useState } from 'react';
import { Check, LayoutGrid, Package, Plus } from 'lucide-react';
import { AvailableProduct } from './PosTypes';
import { PosProductImage } from './PosProductImage';
import { EmptyState, SearchInput } from '../ui';
import { cn } from '../../lib/cn';
import { formatQty, formatMoneyRaw } from '../../lib/formatters';
import { availableSellUnits, sellUnitContains, sellUnitPrice } from '../../lib/sellUnits';

interface PosProductGridProps {
  searchProduct: string;
  setSearchProduct: (val: string) => void;
  productSearchInputRef: React.RefObject<HTMLInputElement | null>;
  selectedCategories: string[];
  setSelectedCategories: React.Dispatch<React.SetStateAction<string[]>>;
  validCategories: string[];
  /** Sellable products per category and in total, for the chip counts. */
  categoryCounts: Record<string, number>;
  allCount: number;
  /** Products after the (deferred) search and category filter. */
  availableProducts: AvailableProduct[];
  /** First available product for the search text as typed (Enter adds it before the deferred list catches up). */
  findFirstMatch: (search: string) => AvailableProduct | undefined;
  cartQtyByProductId: Record<string, number>;
  openQuickModal: (product: AvailableProduct) => void;
  addToCart: (product: AvailableProduct, qty?: number) => boolean;
  mobileTab: 'catalog' | 'cart';
  showSearch: boolean;
  showCategories: boolean;
}

/** Loose items, packs and products with cash shortcuts open quick entry; anything else adds one unit. */
const opensQuickEntry = (product: AvailableProduct) =>
  product.allow_loose_sale !== false
  || (Array.isArray(product.variants) && product.variants.length > 0)
  || (Array.isArray(product.quick_amounts) && product.quick_amounts.length > 0);

export const PosProductGrid = memo(function PosProductGrid({
  searchProduct,
  setSearchProduct,
  productSearchInputRef,
  selectedCategories,
  setSelectedCategories,
  validCategories,
  categoryCounts,
  allCount,
  availableProducts,
  findFirstMatch,
  cartQtyByProductId,
  openQuickModal,
  addToCart,
  mobileTab,
  showSearch,
  showCategories
}: PosProductGridProps) {
  const catalog = useRef<HTMLElement>(null);
  const handleSelect = (product: AvailableProduct) => {
    if (opensQuickEntry(product)) openQuickModal(product);
    else addToCart(product, 1);
  };
  const latest = useRef({ handleSelect, openQuickModal });
  latest.current = { handleSelect, openQuickModal };
  // Stable handlers for every card, so memoised cards ignore parent renders.
  const [onCardSelect] = useState(() => (product: AvailableProduct) => latest.current.handleSelect(product));
  const [onCardContext] = useState(() => (product: AvailableProduct) => { if (opensQuickEntry(product)) latest.current.openQuickModal(product); });

  return (
    <section
      ref={catalog}
      aria-label="Products"
      className={cn(
        'pos-catalog-panel h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-card border border-line bg-surface shadow-e1',
        mobileTab === 'catalog' ? 'flex' : 'hidden',
      )}
    >
      <div data-has-filters={showSearch || showCategories} className="pos-catalog-filters z-10 flex shrink-0 flex-col gap-2.5 border-b border-line bg-surface p-3">
        <div className="hidden items-baseline justify-between gap-2 px-0.5 lg:flex">
          <h2 className="text-[15px] font-bold tracking-tight text-fg">Choose a product</h2>
          <span className="text-xs text-fg-subtle">Tap to set amount or quantity</span>
        </div>

        {showSearch && (
          <SearchInput
            ref={productSearchInputRef}
            className="pos-search"
            aria-label="Search products"
            placeholder="Search products by name..."
            shortcut="F2"
            autoComplete="off"
            value={searchProduct}
            onChange={setSearchProduct}
            onKeyDown={(event: React.KeyboardEvent<HTMLInputElement>) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                const product = findFirstMatch(event.currentTarget.value);
                if (product) handleSelect(product);
              } else if (event.key === 'ArrowDown') {
                event.preventDefault();
                catalog.current?.querySelector<HTMLButtonElement>('[data-pos-product]:not(:disabled)')?.focus();
              }
            }}
          />
        )}

        {showCategories && validCategories.length > 0 && (
          <div className="pos-product-categories -mx-3 flex items-center gap-2 overflow-x-auto px-3 pb-0.5 scrollbar-hide" role="group" aria-label="Product categories">
            <CategoryChip
              label="All"
              icon={<LayoutGrid className="size-4" />}
              count={allCount}
              active={selectedCategories.length === 0}
              onClick={() => setSelectedCategories([])}
            />
            {validCategories.map(cat => (
              <CategoryChip
                key={cat}
                label={cat}
                count={categoryCounts[cat] || 0}
                active={selectedCategories.includes(cat)}
                onClick={() => setSelectedCategories(prev => prev.includes(cat) ? [] : [cat])}
              />
            ))}
          </div>
        )}
      </div>

      <div className="pos-catalog-scroll min-h-0 flex-1 overflow-y-auto bg-canvas/60 p-3">
        {availableProducts.length === 0 ? (
          <EmptyState
            icon={<Package />}
            title="No products found"
            description="Try searching with a different keyword or category"
          />
        ) : (
          <div className="pos-product-cards grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2.5 sm:gap-3">
            {availableProducts.map(product => (
              <PosProductCard
                key={product.id}
                product={product}
                inCartQty={cartQtyByProductId[product.id] || 0}
                onSelect={onCardSelect}
                onContext={onCardContext}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
});

function CategoryChip({ label, count, active, icon, onClick }: { label: string; count: number; active: boolean; icon?: React.ReactNode; onClick: () => void; key?: React.Key }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'inline-flex h-10 shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-[13px] font-semibold transition-colors duration-150',
        active
          ? 'border-transparent bg-brand text-brand-on shadow-e1-lit'
          : 'border-line bg-surface text-fg-muted hover:border-line-strong hover:bg-surface-2 hover:text-fg',
      )}
    >
      {icon}
      <span>{label}</span>
      <span className={cn('min-w-5 rounded-full px-1.5 text-center text-[11px] font-bold tabular-nums leading-5', active ? 'bg-brand-on/15 text-brand-on' : 'bg-surface-2 text-fg-subtle')}>
        {count}
      </span>
    </button>
  );
}

const STOCK_TONE = {
  ok: { dot: 'bg-success', text: 'text-fg-subtle' },
  low: { dot: 'bg-warning', text: 'text-warning-fg' },
  out: { dot: 'bg-danger', text: 'text-danger-fg' },
} as const;

interface PosProductCardProps {
  product: AvailableProduct;
  inCartQty: number;
  onSelect: (product: AvailableProduct) => void;
  onContext: (product: AvailableProduct) => void;
}

/** One catalog tile. Memoised: it only re-renders when its product or its in-cart quantity changes. */
const PosProductCard = memo(function PosProductCard({ product, inCartQty, onSelect, onContext }: PosProductCardProps) {
  const isAvailable = product.is_available;
  const activeVariants = (product.variants || []).filter((v: any) => v.isActive !== false);
  const hasVariants = activeVariants.length > 0;
  const isLooseAllowed = product.allow_loose_sale !== false;
  const totalVStock = product.total_variant_stock || 0;
  // Dozen / tray units sell from main stock even when loose sale is off.
  const mainStockUnits = activeVariants.filter((v: any) => v.deduct_from_base === true);
  const usesMainStock = isLooseAllowed || mainStockUnits.length > 0;
  const isPhysicallyOut = usesMainStock ? (product.stock <= 0 && totalVStock <= 0) : totalVStock <= 0;

  // An empty pack price follows the loose rate times its size, as at checkout.
  const variantPrices = hasVariants ? activeVariants.map((v: any) => sellUnitPrice(product.price, sellUnitContains(v), v.selling_price)).filter((p: number) => p > 0) : [];
  const minVPrice = variantPrices.length ? Math.min(...variantPrices) : product.price;
  const maxVPrice = variantPrices.length ? Math.max(...variantPrices) : product.price;

  // Single-variant label without repeating the product name (e.g. 'Bottle', not 'Badam Doodh Bottle')
  const singleVariantCleanLabel = hasVariants && activeVariants.length === 1
    ? (activeVariants[0]?.name?.replace(new RegExp(product.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), '').trim() || activeVariants[0]?.name || 'Pack')
    : 'Pack';

  const onlyMainUnit = !isLooseAllowed && mainStockUnits.length === 1 ? mainStockUnits[0] : null;
  const mainSellable = onlyMainUnit ? availableSellUnits(product.stock, 0, onlyMainUnit) : product.stock;
  const stockValue = usesMainStock ? (product.stock > 0 ? mainSellable : totalVStock) : totalVStock;
  const stockTone = isPhysicallyOut ? 'out' : stockValue > 5 ? 'ok' : 'low';
  const stockLabel = isPhysicallyOut
    ? 'Out of stock'
    : usesMainStock && product.stock > 0
      ? (onlyMainUnit ? `${formatQty(mainSellable)} ${onlyMainUnit.name || 'Pack'}` : `${formatQty(product.stock)} ${product.unit}`)
      : `${formatQty(totalVStock)} Packs`;

  const isPackPricing = !isLooseAllowed && hasVariants;
  const priceMain = isPackPricing
    ? (minVPrice === maxVPrice ? formatMoneyRaw(minVPrice) : `${formatMoneyRaw(minVPrice)}–${formatMoneyRaw(maxVPrice)}`)
    : formatMoneyRaw(product.price);
  const priceSuffix = isPackPricing ? (minVPrice === maxVPrice ? singleVariantCleanLabel : '') : product.unit;
  const inCart = inCartQty > 0;
  const tone = STOCK_TONE[stockTone];

  return (
    <button
      type="button"
      data-pos-product={product.id}
      data-in-cart={inCart}
      aria-label={`${product.name}, Rs ${priceMain}${priceSuffix ? ` per ${priceSuffix}` : ''}, ${isAvailable ? stockLabel : 'out of stock'}${inCart ? `, ${formatQty(inCartQty)} ${product.unit} in cart` : ''}`}
      onClick={() => onSelect(product)}
      onContextMenu={event => { event.preventDefault(); onContext(product); }}
      disabled={!isAvailable}
      className={cn(
        'pos-product-card group relative flex min-w-0 cursor-pointer flex-col rounded-card border bg-surface p-2 text-left shadow-e1',
        'transition-[transform,box-shadow,border-color] duration-200 ease-out-expo',
        'disabled:cursor-not-allowed disabled:bg-surface-2/60 disabled:shadow-none',
        inCart ? 'border-brand-accent ring-1 ring-brand-accent/40' : 'border-line',
      )}
    >
      <PosProductImage className="aspect-[4/3] w-full rounded-xl" name={product.name} imageUrl={product.image_url} isAvailable={isAvailable}>
        {hasVariants && (
          <span className="absolute left-2 top-2 z-[2] rounded-full bg-surface px-2 py-0.5 text-[11px] font-semibold text-fg-muted shadow-e1 ring-1 ring-inset ring-line">
            {activeVariants.length} {activeVariants.length === 1 ? 'pack' : 'packs'}
          </span>
        )}
        {inCart && (
          <span className="absolute right-2 top-2 z-[3] inline-flex h-6 items-center gap-1 rounded-full bg-brand px-2 text-[11px] font-bold tabular-nums text-brand-on shadow-e1">
            <Check className="size-3" strokeWidth={3} aria-hidden="true" />
            {formatQty(inCartQty)} {product.unit}
          </span>
        )}
        {!isAvailable && (
          <span className="absolute inset-0 z-[4] grid place-items-center bg-surface/55">
            <span className="rounded-full bg-danger px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-white shadow-e1">Out of stock</span>
          </span>
        )}
      </PosProductImage>

      <div className="flex min-w-0 flex-1 flex-col gap-2 px-1 pb-0.5 pt-2.5">
        <h3 className={cn('line-clamp-2 min-h-[2.6em] break-words text-[14px] font-bold leading-[1.3] tracking-tight text-fg', !isAvailable && 'text-fg-subtle')} title={product.name}>
          {product.name}
        </h3>
        <div className="mt-auto flex items-end justify-between gap-2">
          <div className="min-w-0">
            <p className={cn('flex min-w-0 items-baseline gap-0.5 whitespace-nowrap', !isAvailable && 'opacity-60')}>
              <span className="text-[11px] font-semibold text-fg-subtle">Rs</span>
              <strong className="shrink-0 text-[18px] font-bold leading-none tracking-tight tabular-nums text-fg">{priceMain}</strong>
              {priceSuffix && <span className="min-w-0 truncate text-[11px] font-semibold text-fg-subtle">/{priceSuffix}</span>}
            </p>
            {isAvailable && (
              <p className={cn('mt-1.5 flex items-center gap-1.5 truncate text-[11px] font-semibold tabular-nums', tone.text)}>
                <span className={cn('size-1.5 shrink-0 rounded-full', tone.dot)} aria-hidden="true" />
                <span className="truncate">{stockLabel}</span>
              </p>
            )}
          </div>
          <span
            aria-hidden="true"
            className={cn(
              'pos-card-add grid size-9 shrink-0 place-items-center rounded-control transition-colors duration-150',
              inCart ? 'bg-brand text-brand-on' : 'bg-brand-soft text-brand-fg',
              !isAvailable && 'bg-surface-3 text-fg-faint',
            )}
          >
            {inCart ? <Check className="size-4" strokeWidth={3} /> : <Plus className="size-[18px]" strokeWidth={2.5} />}
          </span>
        </div>
      </div>
    </button>
  );
});
