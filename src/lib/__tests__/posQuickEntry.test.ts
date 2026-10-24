import { describe, expect, it } from 'vitest';
import {
  buildQuickPreview,
  calculateQuickEntry,
  getQuickPresets,
  hasConfiguredCashShortcuts,
  stepQuickQuantity,
  stepWholeQuantity
} from '../posQuickEntry';

describe('calculateQuickEntry', () => {
  it('turns a rupee amount into a three-decimal quantity and keeps the rupees exact', () => {
    expect(calculateQuickEntry('100', 'amount', 280, false)).toEqual({ qty: 0.357, total: 100, error: '' });
    expect(calculateQuickEntry('50', 'amount', 3, false)).toEqual({ qty: 16.667, total: 50, error: '' });
  });

  it('prices a quantity at the rate, rounded to the paisa', () => {
    expect(calculateQuickEntry('0.25', 'qty', 220, false)).toEqual({ qty: 0.25, total: 55, error: '' });
    expect(calculateQuickEntry('1.5', 'qty', 145.67, false)).toEqual({ qty: 1.5, total: 218.51, error: '' });
    expect(calculateQuickEntry('0.5', 'qty', 20.15, false)).toEqual({ qty: 0.5, total: 10.08, error: '' });
  });

  it('only accepts whole packs for packaged items', () => {
    expect(calculateQuickEntry('3', 'qty', 120, true)).toEqual({ qty: 3, total: 360, error: '' });
    expect(calculateQuickEntry('2.5', 'qty', 120, true).error).toMatch(/whole numbers/);
    expect(calculateQuickEntry('360', 'amount', 120, true)).toEqual({ qty: 3, total: 360, error: '' });
    expect(calculateQuickEntry('300', 'amount', 120, true).error).toMatch(/whole packs/);
  });

  it('rejects missing rates and bad numbers', () => {
    expect(calculateQuickEntry('100', 'amount', 0, false).error).toMatch(/selling rate/);
    expect(calculateQuickEntry('100', 'amount', NaN, false).error).toMatch(/selling rate/);
    expect(calculateQuickEntry('', 'amount', 100, false).error).toMatch(/Enter an amount/);
    expect(calculateQuickEntry('-5', 'amount', 100, false).error).toMatch(/valid positive/);
    expect(calculateQuickEntry('1e3', 'amount', 100, false).error).toMatch(/valid positive/);
    expect(calculateQuickEntry('0', 'qty', 100, false).error).toMatch(/greater than zero/);
  });

  it('refuses an amount too small to make any quantity', () => {
    expect(calculateQuickEntry('0.001', 'amount', 5000, false).error).toMatch(/too small/);
  });
});

describe('quantity steppers', () => {
  it('steps whole counts from a fractional start', () => {
    expect(stepWholeQuantity(2.4, 1)).toBe(3);
    expect(stepWholeQuantity(2.4, -1)).toBe(2);
    expect(stepWholeQuantity(0.5, -1)).toBe(0);
    expect(stepWholeQuantity(NaN, 1)).toBe(1);
  });

  it('walks kg in pao steps below one kilo', () => {
    expect(stepQuickQuantity(0.1, 1, 'kg')).toBe(0.25);
    expect(stepQuickQuantity(0.25, 1, 'kg')).toBe(0.5);
    expect(stepQuickQuantity(0.75, 1, 'kg')).toBe(1);
    expect(stepQuickQuantity(1, 1, 'kg')).toBe(2);
    expect(stepQuickQuantity(1, -1, 'kg')).toBe(0.75);
    expect(stepQuickQuantity(0.25, -1, 'kg')).toBe(0.25);
    expect(stepQuickQuantity(2.4, -1, 'kg')).toBe(2);
  });

  it('walks litres in half-litre steps and packs in whole counts', () => {
    expect(stepQuickQuantity(0.3, 1, 'L')).toBe(0.5);
    expect(stepQuickQuantity(0.5, -1, 'liter')).toBe(0.5);
    expect(stepQuickQuantity(1, -1, 'l')).toBe(0.5);
    expect(stepQuickQuantity(1, -1, 'kg', true)).toBe(1);
    expect(stepQuickQuantity(3, 1, 'pcs')).toBe(4);
    expect(stepQuickQuantity(0, 1, 'pcs')).toBe(2);
    expect(stepQuickQuantity(0.3, 1, 'Ltr')).toBe(0.5);
  });

  it('walks grams and millilitres a glass / pao (250) at a time', () => {
    expect(stepQuickQuantity(0, 1, 'ml')).toBe(500);
    expect(stepQuickQuantity(100, 1, 'g')).toBe(250);
    expect(stepQuickQuantity(454.545, 1, 'ml')).toBe(500);
    expect(stepQuickQuantity(454.545, -1, 'ml')).toBe(250);
    expect(stepQuickQuantity(250, -1, 'grams')).toBe(250);
    expect(stepQuickQuantity(3, 1, 'ml', true)).toBe(4);
  });
});

describe('quick presets', () => {
  it('uses the product shortcuts when set, cleaned and sorted', () => {
    expect(hasConfiguredCashShortcuts([0, -5])).toBe(false);
    expect(hasConfiguredCashShortcuts([0, 50])).toBe(true);
    expect(getQuickPresets({ mode: 'amount', packaged: false, rate: 200, configured: [200, 50, 50, 0, -1] })).toEqual([50, 200]);
  });

  it('falls back to rate-sized cash defaults', () => {
    expect(getQuickPresets({ mode: 'amount', packaged: false, rate: 2500 })).toEqual([500, 1000, 1500, 1750, 2000, 3500]);
    expect(getQuickPresets({ mode: 'amount', packaged: false, rate: 600 })).toEqual([100, 200, 250, 500, 1000, 1500]);
    expect(getQuickPresets({ mode: 'amount', packaged: false, rate: 220 })).toEqual([50, 100, 150, 200, 250, 500]);
  });

  it('gives unit-shaped quantity presets', () => {
    expect(getQuickPresets({ mode: 'qty', packaged: true, rate: 1 })).toEqual([1, 2, 3, 5, 10, 12]);
    expect(getQuickPresets({ mode: 'qty', packaged: false, unit: 'kg', rate: 1 })[0]).toBe(0.25);
    expect(getQuickPresets({ mode: 'qty', packaged: false, unit: 'L', rate: 1 })[0]).toBe(0.5);
    expect(getQuickPresets({ mode: 'qty', packaged: false, unit: 'litres', rate: 1 })[0]).toBe(0.5);
    expect(getQuickPresets({ mode: 'qty', packaged: false, unit: 'ml', rate: 0.22 })).toEqual([250, 500, 750, 1000, 1500, 2000, 5000]);
    expect(getQuickPresets({ mode: 'qty', packaged: false, unit: 'g', rate: 0.5 })).toEqual([100, 250, 500, 750, 1000, 2000]);
  });

  it('hints small-unit shortcuts in everyday words', () => {
    const ml = buildQuickPreview(0.22, 'ml').qty;
    expect(ml[0]).toMatchObject({ qty: 250, title: '250 ml', hint: '1 Glass', converted: 'Rs 55' });
    expect(buildQuickPreview(0.5, 'g').qty.find(q => q.qty === 250)).toMatchObject({ hint: 'Quarter kg' });
  });

  it('previews the conversions the cashier will see', () => {
    const preview = buildQuickPreview(220, 'kg');
    expect(preview.usingDefaultCash).toBe(true);
    expect(preview.cash[0]).toEqual({ amount: 50, qty: 0.227, label: 'Rs 50', converted: '0.227 kg' });
    expect(preview.qty[0]).toMatchObject({ qty: 0.25, title: '0.25 kg', hint: 'Quarter kg', total: 55, converted: 'Rs 55' });
  });
});
