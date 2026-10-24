import { describe, expect, it } from 'vitest';
import {
  baseUnitWarning,
  buildStandardUnitGroups,
  convertQuantity,
  describeUnitRole,
  detectUnitGroupId,
  getAllAvailableUnits,
  normalizeUnit,
  unitFactor,
  unitTypeOf
} from '../unitConversion';
import type { UnitDefinition } from '../../types';

describe('convertQuantity', () => {
  it('converts weight and volume through the base unit', () => {
    expect(convertQuantity(250, 'g', 'kg')).toBe(0.25);
    expect(convertQuantity(1, 'kg', 'g')).toBe(1000);
    expect(convertQuantity(2, 'pao', 'kg')).toBe(0.5);
    expect(convertQuantity(1, 'maund', 'kg')).toBe(40);
    expect(convertQuantity(500, 'ml', 'L')).toBe(0.5);
    expect(convertQuantity(1, 'man-vol', 'L')).toBe(40);
    expect(convertQuantity(2, 'dz', 'pcs')).toBe(24);
    expect(convertQuantity(1, 'ctn', 'dz')).toBe(2);
  });

  it('understands everyday spellings', () => {
    expect(convertQuantity(1, 'Kilo', 'grams')).toBe(1000);
    expect(convertQuantity(3, 'litres', 'ml')).toBe(3000);
    expect(convertQuantity(4, 'paao', 'kg')).toBe(1);
    expect(convertQuantity(1, 'mun', 'kg')).toBe(40);
    expect(convertQuantity(1, 'dozen', 'pieces')).toBe(12);
  });

  it('returns the same quantity for the same unit, ignoring case', () => {
    expect(convertQuantity(7.25, 'KG', 'kg')).toBe(7.25);
    expect(convertQuantity(-3, 'L', 'L')).toBe(-3);
  });

  it('refuses incompatible or unknown units', () => {
    expect(convertQuantity(1, 'kg', 'L')).toBeNull();
    expect(convertQuantity(1, 'pcs', 'kg')).toBeNull();
    expect(convertQuantity(1, 'bucket', 'kg')).toBeNull();
  });

  it('keeps negatives (returns) and zero, and maps non-finite input to zero', () => {
    expect(convertQuantity(-250, 'g', 'kg')).toBe(-0.25);
    expect(convertQuantity(0, 'g', 'kg')).toBe(0);
    expect(convertQuantity(NaN, 'g', 'kg')).toBe(0);
    expect(convertQuantity(Infinity, 'g', 'kg')).toBe(0);
  });

  it('rounds to the stock precision of three decimals without float noise', () => {
    expect(convertQuantity(3, 'g', 'kg')).toBe(0.003);
    expect(convertQuantity(10, 'tola', 'kg')).toBe(0.117);
    expect(convertQuantity(0.1, 'kg', 'g')).toBe(100);
    expect(convertQuantity(1.23456, 'kg', 'kg')).toBe(1.235);
    expect(Object.is(convertQuantity(-0.01, 'g', 'kg'), 0)).toBe(true);
  });

  it('reads the spellings shops type for litres, kilos and pieces', () => {
    expect(convertQuantity(2.5, 'Ltr', 'ml')).toBe(2500);
    expect(convertQuantity(750, 'ML', 'ltrs')).toBe(0.75);
    expect(convertQuantity(1, 'kgs', 'g')).toBe(1000);
    expect(convertQuantity(2, 'doz', 'nos')).toBe(24);
    expect(convertQuantity(1, undefined as unknown as string, 'kg')).toBeNull();
  });

  it("lets a custom unit's own symbol win over an alias", () => {
    const custom: UnitDefinition[] = [{ id: 'u_ltr', name: 'Big ltr can', symbol: 'ltr', factor: 5, isBase: false, type: 'Volume' }];
    expect(convertQuantity(1, 'ltr', 'L', custom)).toBe(5);
    expect(convertQuantity(1, 'ltr', 'L')).toBe(1);
  });

  it('gives an unrounded factor for rates and the unit group', () => {
    expect(unitFactor('L', 'ml')).toBe(1000);
    expect(unitFactor('kg', 'L')).toBeNull();
    expect(unitFactor('pcs', 'pcs')).toBe(1);
    expect(unitTypeOf('Ltr')).toBe('Volume');
    expect(unitTypeOf('bucket')).toBeNull();
    expect(normalizeUnit(' Kgs ')).toBe('kg');
  });

  it('uses custom units, which can override a system unit', () => {
    const custom: UnitDefinition[] = [
      { id: 'u_tray', name: 'Tray', symbol: 'tray', factor: 30, isBase: false, type: 'Count' },
      { id: 'u_dz_custom', name: 'Baker dozen', symbol: 'dz', factor: 13, isBase: false, type: 'Count' }
    ];
    expect(convertQuantity(2, 'tray', 'pcs', custom)).toBe(60);
    expect(convertQuantity(1, 'dz', 'pcs', custom)).toBe(13);
  });
});

describe('unit catalogue helpers', () => {
  it('groups units by type and detects the group of a symbol', () => {
    const groups = buildStandardUnitGroups();
    expect(groups.map(g => g.id)).toEqual(['ug_vol', 'ug_mass', 'ug_count']);
    expect(groups[0].units.every(u => u.type === 'Volume')).toBe(true);
    expect(detectUnitGroupId('ml')).toBe('ug_vol');
    expect(detectUnitGroupId('pao')).toBe('ug_mass');
    expect(detectUnitGroupId('crate')).toBe('ug_count');
    expect(detectUnitGroupId('unknown')).toBe('ug_count');
  });

  it('marks a custom unit as non-system', () => {
    const units = getAllAvailableUnits([{ id: 'x', name: 'Tin', symbol: 'tin', factor: 1, isBase: false, type: 'Count' }]);
    expect(units.find(u => u.symbol === 'tin')?.isSystem).toBe(false);
    expect(units.find(u => u.symbol === 'kg')?.isSystem).toBe(true);
  });

  it('explains unit roles and warns about pack-sized base units', () => {
    const all = getAllAvailableUnits();
    const find = (symbol: string) => all.find(u => u.symbol === symbol)!;
    expect(describeUnitRole(find('kg')).role).toBe('base');
    expect(describeUnitRole(find('g')).role).toBe('convertible');
    expect(describeUnitRole(find('dz')).role).toBe('fixed-pack');
    expect(describeUnitRole(find('box')).role).toBe('label');
    expect(baseUnitWarning('dz')).toMatch(/pcs as the base unit/);
    expect(baseUnitWarning('maund')).toMatch(/kg as the base unit/);
    expect(baseUnitWarning('kg')).toBe('');
    expect(baseUnitWarning('nothing')).toBe('');
  });
});
