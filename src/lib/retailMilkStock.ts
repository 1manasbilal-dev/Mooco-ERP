import { StockType, type InventoryItem, type ItemDefinition } from '../types';
import { cleanNumber, cleanQty } from './formatters';

export const RETAIL_CHILLER_CAPACITY = 500;

export interface RetailMilkRow {
  id: string;
  itemId?: string;
  name: string;
  /** Unit of liters, rate and costRate: always litres, even when the item is stocked in ml. */
  unit: 'L';
  liters: number;
  /** The inventory row's own unit and quantity ('ml', 2500), for anything that writes stock back. */
  stockUnit: 'L' | 'ml';
  stockQuantity: number;
  rate: number;
  costRate: number;
  value: number;
  costValue: number;
  milkType: 'Buffalo' | 'Cow' | 'Mixed' | 'Goat' | 'Camel';
  percentOfTotal: number;
}

export interface RetailMilkStockSummary {
  rows: RetailMilkRow[];
  /** Unit of liters and the average rates. */
  unit: 'L';
  liters: number;
  totalValue: number;
  totalCostValue: number;
  avgRate: number;
  avgCostRate: number;
}

/** Loose retail milk only; variant packs and unallocated intake are separate stock. */
export function getRetailMilkStock(inventory: InventoryItem[], items: ItemDefinition[]): RetailMilkStockSummary {
  const masters = new Map(items.map(item => [item.id, item]));
  
  const rawRows = inventory.flatMap(stock => {
    const master = stock.item_id ? masters.get(stock.item_id) : undefined;
    // System milk items serve both sales and production, so their inventory row
    // may be labelled Raw Material despite being the POS's loose retail balance.
    const sellable = master?.item_type?.includes('Sale product');
    if (stock.stock_type === StockType.UNALLOCATED || stock.stock_type === StockType.PACKAGING) return [];
    if ((!sellable && stock.stock_type !== StockType.RETAIL_STOCK) || master?.allow_loose_sale === false) return [];
    if (master?.item_type?.includes('Packaging material')) return [];
    if (!sellable && master?.item_type?.includes('Raw material')) return [];
    
    const categories = [stock.category, ...(master?.category || [])].join(' ').toLowerCase();
    const name = stock.name.toLowerCase();
    const isMilk = /\b(milk|doodh)\b/.test(categories) || /\b(milk|doodh|buffalo|cow|mixed)\b/.test(name);
    if (!isMilk || /\b(powder|shake|flavou?red|condensed)\b/.test(name)) return [];
    
    const unit = String(stock.unit || master?.unit || '').trim().toLowerCase();
    const factor = ['l', 'ltr', 'ltrs', 'liter', 'liters', 'litre', 'litres'].includes(unit) ? 1
      : ['ml', 'milliliter', 'milliliters', 'millilitre', 'millilitres'].includes(unit) ? 0.001 : 0;
    const quantity = Number(stock.quantity);
    if (!factor || !Number.isFinite(quantity)) return [];

    // Stock keeps three decimals; two would show 0.125 L as 0.13 L and drift the totals.
    const liters = cleanQty(quantity * factor);
    // Catalog rates are per stock unit; express them per litre so ml stock is valued correctly.
    const rate = cleanNumber((Number(master?.selling_price || stock.price) || 0) / factor, 4);
    const costRate = cleanNumber((Number(master?.cost_price) || 0) / factor, 4);
    const value = Math.round(liters * rate);
    const costValue = Math.round(liters * costRate);

    let milkType: 'Buffalo' | 'Cow' | 'Mixed' | 'Goat' | 'Camel' = 'Mixed';
    if (name.includes('buffalo') || name.includes('bhains')) {
      milkType = 'Buffalo';
    } else if (name.includes('cow') || name.includes('gaye') || name.includes('gaey')) {
      milkType = 'Cow';
    } else if (name.includes('goat') || name.includes('bakri')) {
      milkType = 'Goat';
    } else if (name.includes('camel') || name.includes('oont')) {
      milkType = 'Camel';
    }

    return [{
      id: stock.id,
      itemId: master?.id || stock.item_id,
      name: stock.name,
      unit: 'L' as const,
      liters,
      stockUnit: factor === 1 ? 'L' as const : 'ml' as const,
      stockQuantity: quantity,
      rate,
      costRate,
      value,
      costValue,
      milkType
    }];
  });

  const totalLiters = Math.round(rawRows.reduce((sum, row) => sum + row.liters, 0) * 1000) / 1000;
  const totalValue = rawRows.reduce((sum, row) => sum + row.value, 0);
  const totalCostValue = rawRows.reduce((sum, row) => sum + row.costValue, 0);
  const avgRate = totalLiters > 0 ? Math.round(totalValue / totalLiters) : 0;
  const avgCostRate = totalLiters > 0 ? Math.round(totalCostValue / totalLiters) : 0;

  const rows: RetailMilkRow[] = rawRows.map(row => ({
    ...row,
    percentOfTotal: totalLiters > 0 ? Math.round((row.liters / totalLiters) * 1000) / 10 : 0
  }));

  rows.sort((a, b) => b.liters - a.liters);

  return {
    rows,
    unit: 'L',
    liters: totalLiters,
    totalValue,
    totalCostValue,
    avgRate,
    avgCostRate
  };
}
