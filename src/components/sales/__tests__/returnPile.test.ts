import { describe, expect, it } from 'vitest';
import { returnIsScrap, returnLinePile, type ReturnItemSelection } from '../salesHistoryUtils';

const line = (patch: Partial<ReturnItemSelection>): ReturnItemSelection => ({
  name: 'Anday', soldQty: 2, remainingQty: 2, returnQty: 2, price: 340, isSelected: true, ...patch,
});

describe('returnLinePile', () => {
  it('sends a dozen line back to loose stock at its sold size', () => {
    expect(returnLinePile(line({ unit: 'Dozen', variantId: 'v_dozen', baseUnit: 'pcs', stockDeduction: 12, deductFromBase: true }), 2))
      .toEqual({ kind: 'loose', name: 'loose stock', amount: 24, unit: 'pcs' });
  });

  it('sends a ready-made pack line back to its own pack count', () => {
    expect(returnLinePile(line({ unit: '500 g tub', variantId: 'v_half', stockDeduction: 0.5, wholeOnly: true }), 3))
      .toEqual({ kind: 'pack', name: '500 g tub pack stock', amount: 3, unit: '500 g tub' });
  });

  it('keeps loose lines in their base unit and leaves an unknown pack size open', () => {
    expect(returnLinePile(line({ unit: 'kg', lineUnit: 'kg', isLoose: true }), 1.5)).toEqual({ kind: 'loose', name: 'loose stock', amount: 1.5, unit: 'kg' });
    expect(returnLinePile(line({ unit: 'Tray', variantId: 'v_tray' }), 1).amount).toBeNull();
  });
});

describe('returnIsScrap', () => {
  it('follows the option and the spoiled / defective reason words, like processSalesReturn', () => {
    expect(returnIsScrap('restock', 'Customer Changed Mind')).toBe(false);
    expect(returnIsScrap('scrap_spoilage', 'Customer Changed Mind')).toBe(true);
    expect(returnIsScrap('restock', 'Defective / Spoiled Product')).toBe(true);
    expect(returnIsScrap('restock', 'doodh kharab tha')).toBe(true);
  });
});
