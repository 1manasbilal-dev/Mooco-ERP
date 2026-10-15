/** Product images and heavy catalog structures belong to the catalog, not every saved bill line. */
export function saleItemSnapshot(items: any[]): any[] {
  if (!Array.isArray(items)) return [];
  return items.map(line => {
    const { image_url: _img, quick_amounts: _qa, variants: _vars, variant_stocks: _vs, ...rest } = line;
    return {
      itemId: rest.itemId || rest.id,
      name: rest.name || 'Item',
      qty: Number(rest.qty) || 1,
      price: Number(rest.price) || 0,
      total: Number(rest.total) || ((Number(rest.qty) || 1) * (Number(rest.price) || 0)),
      unit: rest.unit || (rest.variantId ? (rest.variantName || 'Pack') : 'Unit'),
      variantId: rest.variantId || undefined,
      variantName: rest.variantName || undefined,
      baseUnit: rest.baseUnit || undefined,
      stockDeduction: Number(rest.stockDeduction) > 0 ? Number(rest.stockDeduction) : undefined,
      deductFromBase: rest.deductFromBase === true ? true : undefined,
      customTotal: rest.customTotal,
      sort_order: rest.sort_order,
      originalPrice: rest.originalPrice,
      isLoose: rest.isLoose
    };
  });
}

