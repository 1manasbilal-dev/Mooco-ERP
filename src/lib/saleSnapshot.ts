import { cleanNumber } from './formatters';

/** Product images and heavy catalog structures belong to the catalog, not every saved bill line. */
export function saleItemSnapshot(items: any[]): any[] {
  if (!Array.isArray(items)) return [];
  return items.map(line => {
    const { image_url: _img, quick_amounts: _qa, variants: _vars, variant_stocks: _vs, ...rest } = line;
    const qty = Number(rest.qty) || 0;
    const price = Number(rest.price) || 0;
    const customTotal = Number(rest.customTotal);
    // 'loose' / 'base' are the loose pile, not a variant id.
    const variantId = rest.variantId && rest.variantId !== 'loose' && rest.variantId !== 'base' ? rest.variantId : undefined;
    // A pack line always records which pile it took, so returns and reports never guess from today's catalog.
    // A line marked loose took loose stock whatever variant it names (see saleLineStock).
    const deductFromBase = variantId && rest.isLoose !== true
      ? rest.deductFromBase === true
      : (rest.deductFromBase === true || rest.isLoose === true ? true : undefined);
    return {
      itemId: rest.itemId || rest.id,
      name: rest.name || 'Item',
      qty,
      price,
      // Rounded to the paisa: 1.1 x 3 is 3.3000000000000003 in floating point.
      total: Number(rest.total) || (Number.isFinite(customTotal) && customTotal > 0 ? customTotal : cleanNumber(qty * price)),
      unit: rest.unit || (variantId ? (rest.variantName || 'Pack') : 'Unit'),
      variantId,
      variantName: rest.variantName || undefined,
      baseUnit: rest.baseUnit || undefined,
      stockDeduction: Number(rest.stockDeduction) > 0 ? Number(rest.stockDeduction) : undefined,
      deductFromBase,
      cost_price: Number(rest.cost_price) > 0 ? Number(rest.cost_price) : undefined,
      customTotal: rest.customTotal,
      sort_order: rest.sort_order,
      originalPrice: rest.originalPrice,
      isLoose: rest.isLoose
    };
  });
}

