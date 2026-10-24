import { describe, expect, it } from 'vitest';
import { checkItemSetupChange } from '../itemSetupRules';

const curd = {
  name: 'Curd',
  unit: 'kg',
  stock: 0,
  variant_stocks: { tub: 8, dz: 2 },
  variants: [
    { id: 'tub', name: '500 g tub', quantity_in_base_unit: 0.5, isActive: true },
    { id: 'big', name: '1 kg tub', quantity_in_base_unit: 1, isActive: true },
    { id: 'dz', name: 'Scoop', quantity_in_base_unit: 0.25, deduct_from_base: true, isActive: true },
  ],
};

describe('checkItemSetupChange', () => {
  it('blocks a base unit change while any pile holds stock', () => {
    expect(checkItemSetupChange({ ...curd, stock: 3 }, { unit: 'g' }).error).toContain('3 kg loose');
    expect(checkItemSetupChange(curd, { unit: 'g' }).error).toContain('8 × 500 g tub');
    expect(checkItemSetupChange({ ...curd, variant_stocks: { dz: 2 } }, { unit: 'g' }).error).toBeUndefined();
    expect(checkItemSetupChange({ ...curd, stock: 3 }, { unit: ' kg ' }).error).toBeUndefined();
  });

  it('blocks resizing, removing or turning a stocked pack into a multi-unit', () => {
    const resized = curd.variants.map(v => v.id === 'tub' ? { ...v, quantity_in_base_unit: 0.4 } : v);
    expect(checkItemSetupChange(curd, { variants: resized }).error).toContain('size 0.5 kg se 0.4 kg');
    expect(checkItemSetupChange(curd, { variants: curd.variants.filter(v => v.id !== 'tub') }).error).toContain('Pack hatane');
    const multi = curd.variants.map(v => v.id === 'tub' ? { ...v, deduct_from_base: true } : v);
    expect(checkItemSetupChange(curd, { variants: multi }).error).toContain('dozen/tray');
  });

  it('allows the same edits on an empty pack', () => {
    const resized = curd.variants.map(v => v.id === 'big' ? { ...v, quantity_in_base_unit: 2 } : v);
    expect(checkItemSetupChange(curd, { variants: resized })).toEqual({});
    expect(checkItemSetupChange(curd, { variants: curd.variants.filter(v => v.id !== 'big') })).toEqual({});
  });

  it('a stray count on a multi-unit blocks turning it into a pack', () => {
    const toPack = curd.variants.map(v => v.id === 'dz' ? { ...v, deduct_from_base: false } : v);
    expect(checkItemSetupChange(curd, { variants: toPack }).error).toContain('purana count 2');
  });

  it('hiding a stocked pack is allowed with a notice', () => {
    const hidden = curd.variants.map(v => v.id === 'tub' ? { ...v, isActive: false } : v);
    const check = checkItemSetupChange(curd, { variants: hidden });
    expect(check.error).toBeUndefined();
    expect(check.notice).toContain('(hidden)');
  });
});
