import React, { useRef } from 'react';
import { Search, X, LayoutGrid, Package, Check, Plus } from 'lucide-react';
import { AvailableProduct } from './PosTypes';
import { PosProductImage } from './PosProductImage';
import { formatQty, formatCurrency, formatMoneyRaw } from '../../lib/formatters';

interface PosProductGridProps {
  searchProduct: string;
  setSearchProduct: (val: string) => void;
  productSearchInputRef: React.RefObject<HTMLInputElement | null>;
  selectedCategories: string[];
  setSelectedCategories: React.Dispatch<React.SetStateAction<string[]>>;
  validCategories: string[];
  availableProducts: AvailableProduct[];
  items: any[];
  cartQtyByProductId: Record<string, number>;
  openQuickModal: (product: AvailableProduct) => void;
  addToCart: (product: AvailableProduct, qty?: number, variantName?: string, customPrice?: number, deductionQty?: number, variantId?: string) => void;
  mobileTab: 'catalog' | 'cart';
  showSearch: boolean;
  showCategories: boolean;
}

export const PosProductGrid: React.FC<PosProductGridProps> = ({
  searchProduct,
  setSearchProduct,
  productSearchInputRef,
  selectedCategories,
  setSelectedCategories,
  validCategories,
  availableProducts,
  items,
  cartQtyByProductId,
  openQuickModal,
  addToCart,
  mobileTab,
  showSearch,
  showCategories
}) => {
  const catalog = useRef<HTMLDivElement>(null);
  const handleCardClick = (product: AvailableProduct) => {
    const hasVariants = product.variants && Array.isArray(product.variants) && product.variants.length > 0;
    const isLooseAllowed = product.allow_loose_sale !== false;
    const hasCustomShortcuts = product.quick_amounts && Array.isArray(product.quick_amounts) && product.quick_amounts.length > 0;

    // Any loose item (Milk, Yogurt), or item with variants, or custom shortcuts opens the quick portion modal instantly
    if (isLooseAllowed || (hasVariants && !isLooseAllowed) || hasCustomShortcuts) {
      openQuickModal(product);
    } else {
      addToCart(product, 1);
    }
  };

  return (
    <div ref={catalog} className={`pos-catalog-panel flex-[1.4] flex-col bg-white dark:bg-slate-900 rounded-xl border border-slate-200/90 dark:border-slate-800 shadow-sm overflow-hidden h-full min-h-0 ${
      mobileTab === 'catalog' ? 'flex' : 'hidden'
    }`}>
      {/* Catalog Top Filter Strip */}
      <div data-has-filters={showSearch || showCategories} className="pos-catalog-filters p-3 border-b border-slate-100 dark:border-slate-800 flex flex-col gap-2 shrink-0 bg-white dark:bg-slate-900 z-10">
        <div className="pos-catalog-heading"><h2>Choose a product</h2><span>Tap to set amount or quantity</span></div>
        {showSearch && <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <input 
            ref={productSearchInputRef}
            type="text" 
            aria-label="Search products"
            placeholder="Search products by name... [F2]" 
            className="w-full pl-9 pr-8 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:bg-white dark:focus:bg-slate-900 focus:border-lime-500 focus:ring-2 focus:ring-lime-500/20 rounded-xl text-xs sm:text-sm font-medium outline-none transition-all placeholder:text-slate-400 text-slate-900 dark:text-slate-100" 
            value={searchProduct} 
            onChange={e => setSearchProduct(e.target.value)} 
            onKeyDown={event => {
              if (event.key === 'Enter') {
                event.preventDefault();
                const product = availableProducts.find(item => item.is_available);
                if (product) handleCardClick(product);
              } else if (event.key === 'ArrowDown') {
                event.preventDefault();
                catalog.current?.querySelector<HTMLButtonElement>('[data-pos-product]:not(:disabled)')?.focus();
              }
            }}
          />
          {searchProduct && (
            <button 
              type="button" aria-label="Clear product search"
              onClick={() => setSearchProduct('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5 cursor-pointer"
            >
              <X size={14} />
            </button>
          )}
        </div>}

        {/* Category Chips Bar */}
        {showCategories && <div className="pos-product-categories flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide items-center">
          <button 
            type="button" aria-pressed={selectedCategories.length === 0}
            onClick={() => setSelectedCategories([])}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all flex items-center gap-1.5 border shadow-xs cursor-pointer ${
              selectedCategories.length === 0
                ? 'bg-lime-600 text-white border-lime-600 shadow-xs' 
                : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700'
            }`}
          >
            <LayoutGrid size={13} />
            All ({availableProducts.length})
          </button>
          {validCategories.map(cat => {
            const isSelected = selectedCategories.includes(cat);
            const count = (items || []).filter(i => 
              i && i.isActive && 
              Array.isArray(i.item_type) && i.item_type.includes('Sale product') && 
              !i.item_type.includes('Packaging material') &&
              Array.isArray(i.category) && i.category.includes(cat)
            ).length;

            return (
              <button 
                key={cat} 
                type="button" aria-pressed={isSelected}
                onClick={() => setSelectedCategories(prev => prev.includes(cat) ? [] : [cat])}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all border flex items-center gap-1.5 cursor-pointer ${
                  isSelected 
                    ? 'bg-lime-600 text-white border-lime-600 shadow-sm' 
                    : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
                }`}
              >
                <span>{cat}</span>
                <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${isSelected ? 'bg-white/20 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400'}`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>}
      </div>

      {/* Product Grid (Full scrollable catalog) */}
      <div className="pos-catalog-scroll flex-1 overflow-y-auto p-3 bg-slate-50/60 dark:bg-slate-950/40">
        {availableProducts.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full py-12 text-slate-400">
            <div className="w-14 h-14 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm flex items-center justify-center text-slate-300 mb-2.5">
              <Package size={26} />
            </div>
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">No products found</p>
            <p className="text-xs text-slate-400 mt-0.5">Try searching with a different keyword or category</p>
          </div>
        ) : (
          <div className="pos-product-cards grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3">
            {availableProducts.map(product => {
              const isAvailable = product.is_available;
              const inCartQty = cartQtyByProductId[product.id] || 0;
              const hasVariants = product.variants && product.variants.length > 0;
              const isLooseAllowed = product.allow_loose_sale !== false;
              const totalVStock = product.total_variant_stock || 0;
              const isPhysicallyOut = isLooseAllowed 
                ? (product.stock <= 0 && totalVStock <= 0) 
                : (totalVStock <= 0);

              const variantPrices = hasVariants ? product.variants.map((v: any) => v.selling_price || 0).filter((p: number) => p > 0) : [];
              const minVPrice = variantPrices.length ? Math.min(...variantPrices) : product.price;
              const maxVPrice = variantPrices.length ? Math.max(...variantPrices) : product.price;

              // Clean single-variant label without duplicating product name (e.g., 'Bottle' instead of 'Badam Doodh Bottle')
              const singleVariantCleanLabel = hasVariants && product.variants.length === 1
                ? (product.variants[0]?.name?.replace(new RegExp(product.name, 'i'), '').trim() || product.variants[0]?.name || 'Pack')
                : 'Pack';

              // Stock pill tone + label (overlaid on the image)
              const stockValue = isLooseAllowed ? (product.stock > 0 ? product.stock : totalVStock) : totalVStock;
              const stockTone = isPhysicallyOut ? 'out' : stockValue > 5 ? 'ok' : 'low';
              const stockLabel = isPhysicallyOut
                ? 'Out of stock'
                : isLooseAllowed && product.stock > 0
                ? `${formatQty(product.stock)} ${product.unit}`
                : `${formatQty(totalVStock)} Packs`;

              // Price parts (big number + small prefix / suffix)
              const isPackPricing = !isLooseAllowed && hasVariants;
              const priceMain = isPackPricing
                ? (minVPrice === maxVPrice ? formatMoneyRaw(minVPrice) : `${formatMoneyRaw(minVPrice)}–${formatMoneyRaw(maxVPrice)}`)
                : formatMoneyRaw(product.price);
              const priceSuffix = isPackPricing
                ? (minVPrice === maxVPrice ? singleVariantCleanLabel : '')
                : product.unit;

              return (
                <button 
                  key={product.id} 
                  type="button" data-pos-product={product.id} aria-label={`Select ${product.name}`}
                  onClick={() => handleCardClick(product)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    const hasVars = product.variants && Array.isArray(product.variants) && product.variants.length > 0;
                    const isLoose = product.allow_loose_sale !== false;
                    const hasCustom = product.quick_amounts && Array.isArray(product.quick_amounts) && product.quick_amounts.length > 0;
                    if (hasVars || isLoose || hasCustom) {
                      openQuickModal(product);
                    }
                  }}
                  disabled={!isAvailable} 
                  data-in-cart={inCartQty > 0}
                  className="pos-product-card group"
                  style={{ WebkitTouchCallout: 'none', userSelect: 'none' }}
                  title="Click to Add / Select Portion"
                >
                  {/* Square 1:1 Product Image with Overlaid Badges */}
                  <PosProductImage 
                    className="pos-catalog-image"
                    name={product.name} 
                    imageUrl={product.image_url}
                    isAvailable={isAvailable}
                  >
                    <span className="pos-card-shade" aria-hidden="true" />

                    {/* Variant Pack Badge (Top-Left) */}
                    {hasVariants && (
                      <span className="pos-card-tag">{product.variants.length} Packs</span>
                    )}

                    {/* Cart Quantity Badge (Top-Right) */}
                    {inCartQty > 0 && (
                      <span className="pos-card-cart-badge">
                        <Check size={11} strokeWidth={3.2} />
                        <span>{formatQty(inCartQty)}</span>
                      </span>
                    )}

                    {/* Stock Pill (Bottom-Left) */}
                    {isAvailable && (
                      <span className="pos-card-stock" data-tone={stockTone}>
                        <i aria-hidden="true" />
                        {stockLabel}
                      </span>
                    )}

                    {/* Out of Stock Overlay */}
                    {!isAvailable && (
                      <div className="pos-card-unavailable">
                        <span>Out of Stock</span>
                      </div>
                    )}
                  </PosProductImage>

                  {/* Card Body */}
                  <div className="pos-card-body">
                    <h3 className="pos-card-title" title={product.name}>
                      {product.name}
                    </h3>

                    <div className="pos-card-footer">
                      <div className="pos-card-price">
                        <span className="pos-card-price-prefix">Rs</span>
                        <strong>{priceMain}</strong>
                        {priceSuffix && <span className="pos-card-price-suffix">/{priceSuffix}</span>}
                      </div>

                      <span className="pos-card-add" aria-hidden="true">
                        {inCartQty > 0 ? <Check size={15} strokeWidth={3} /> : <Plus size={16} strokeWidth={2.75} />}
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
