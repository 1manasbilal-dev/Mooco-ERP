import { describe, expect, it } from 'vitest';
import {
  matchVoiceProduct,
  normalizeSpeech,
  parseVoiceSale,
  planVoiceLine,
  type VoiceProduct,
  type VoiceSegment,
} from '../voiceSale';
import { posSellOptions } from '../../components/pos/posStock';

// The shop's real catalog shape (names, units, packs); stock is plenty so only the voice rules decide.
const p = (id: string, name: string, unit: string, price: number, variants: any[] = [], allow_loose_sale = true) =>
  ({ id, name, unit, price, allow_loose_sale, variants, stock: 100, variant_stocks: Object.fromEntries(variants.map(v => [v.id, 50])) });
const CATALOG = [
  p('cow', 'Cow Milk', 'L', 170),
  p('buf', 'Buffalo Milk', 'L', 200),
  p('dahi', 'Dahi', 'kg', 220),
  p('egg', 'Egg', 'pcs', 25, [
    { id: 'dz', name: 'Dozen', quantity_in_base_unit: 12, selling_price: 250, deduct_from_base: true },
    { id: 'tray', name: 'Tray', quantity_in_base_unit: 30, selling_price: 620, deduct_from_base: true },
  ]),
  p('kheer', 'Shahi Kheer ', 'kg', 0, [
    { id: 'cup', name: 'Shahi Kheer Cup', quantity_in_base_unit: 0.17, selling_price: 120 },
    { id: 'tub', name: 'Shahi Kheer Tub (0.5Kg)', quantity_in_base_unit: 0.5, selling_price: 350 },
  ], false),
  p('badam', 'Badam Doodh', 'kg', 0, [{ id: 'bottle', name: 'Badam Doodh Bottle ', quantity_in_base_unit: 0.25, selling_price: 120 }], false),
  p('cghee', 'Cow Desi Ghee', 'kg', 3500),
  p('bghee', 'Buffalo Desi Ghee', 'kg', 3500),
  p('bl', 'Dawn Bread Large', 'pcs', 240),
  p('bs', 'Dawn Bread Small', 'pcs', 130),
  p('cakes', 'Dawn Fruit Cake Small', 'pcs', 110),
  p('cakel', 'Dawn Fruit Cake Large', 'pcs', 210),
  p('b4', 'Dawn Bread 4 Pice', 'pcs', 50),
  p('muffin', 'Dawn Muffins', 'pcs', 20, [{ id: 'box', name: 'Box', quantity_in_base_unit: 12, selling_price: 240 }]),
  p('rusk', 'Special Rusk', 'kg', 520, [{ id: 'r500', name: 'Special Rusk 500Gm', quantity_in_base_unit: 0.5, selling_price: 260 }], false),
  p('bran', 'Dawn Bran Bread', 'pcs', 180),
];
const products = CATALOG as unknown as VoiceProduct[];

/** What the counter would add for one spoken sentence: product, option, qty and total per item. */
function hear(text: string, picks: Record<string, string> = {}) {
  const { segments, command } = parseVoiceSale(text);
  const lines = segments.map(segment => {
    const match = matchVoiceProduct(segment, products, picks);
    if (match.kind !== 'one') return { match: match.kind, ...(match.kind === 'choose' ? { choices: match.productIds } : {}) };
    const product = CATALOG.find(item => item.id === match.productId)!;
    const plan = planVoiceLine(segment, product as unknown as VoiceProduct, posSellOptions(product as any, []), picks);
    if (plan.kind === 'add') return { product: product.id, option: plan.optionId, qty: plan.qty, total: plan.total };
    if (plan.kind === 'choose') return { product: product.id, choosePack: plan.optionIds };
    return { product: product.id, problem: plan.message };
  });
  return { lines, command };
}

describe('normalizeSpeech', () => {
  it('reads Urdu digits, splits glued units and keeps decimals', () => {
    expect(normalizeSpeech('۲ کلو دہی')).toBe('2 کلو دہی');
    expect(normalizeSpeech('2kg Dahi, Rs200 ka doodh.')).toBe('2 kg dahi , rs 200 ka doodh ,');
    expect(normalizeSpeech('2.5 litre')).toBe('2.5 litre');
    expect(normalizeSpeech('1/2 kilo')).toBe('0.5 kilo');
    expect(normalizeSpeech('1,000 ka ghee')).toBe('1000 ka ghee');
  });

  it('drops "de do" so it is not read as the number 2', () => {
    expect(normalizeSpeech('ek kilo dahi de do')).toBe('ek kilo dahi');
    expect(normalizeSpeech('ایک کلو دہی دے دو')).toBe('ایک کلو دہی');
  });
});

describe('parseVoiceSale numbers', () => {
  const qty = (text: string) => parseVoiceSale(`${text} dahi`).segments[0]?.qty;
  it('combines Urdu number words', () => {
    expect(qty('do sau')).toBe(200);
    expect(qty('dedh sau')).toBe(150);
    expect(qty('dhai sau')).toBe(250);
    expect(qty('sawa sau')).toBe(125);
    expect(qty('saarhe teen')).toBe(3.5);
    expect(qty('saarhe teen sau')).toBe(350);
    expect(qty('paune do')).toBe(1.75);
    expect(qty('ek hazaar paanch sau')).toBe(1500);
    expect(qty('ڈیڑھ')).toBe(1.5);
    expect(qty('دو سو')).toBe(200);
  });
});

describe('voice sale lines', () => {
  it('sells loose weight and volume', () => {
    expect(hear('do kilo dahi').lines).toEqual([{ product: 'dahi', option: 'base', qty: 2, total: 440 }]);
    expect(hear('دو کلو دہی').lines).toEqual([{ product: 'dahi', option: 'base', qty: 2, total: 440 }]);
    expect(hear('aadha kilo dahi').lines[0]).toMatchObject({ qty: 0.5, total: 110 });
    expect(hear('ek pao dahi').lines[0]).toMatchObject({ qty: 0.25, total: 55 });
    expect(hear('pao kilo dahi').lines[0]).toMatchObject({ qty: 0.25 });
    expect(hear('500 gram dahi').lines[0]).toMatchObject({ qty: 0.5 });
    expect(hear('dahi do kilo').lines[0]).toMatchObject({ product: 'dahi', qty: 2 });
  });

  it('treats a kilo of milk as a litre and needs cow or buffalo when both are sold', () => {
    expect(hear('gaye ka doodh do kilo').lines).toEqual([{ product: 'cow', option: 'base', qty: 2, total: 340 }]);
    expect(hear('بھینس کا دودھ ایک لیٹر').lines).toEqual([{ product: 'buf', option: 'base', qty: 1, total: 200 }]);
    expect(hear('ek litre doodh').lines[0]).toMatchObject({ match: 'choose' });
    expect((hear('ek litre doodh').lines[0] as any).choices).toEqual(expect.arrayContaining(['cow', 'buf']));
  });

  it('remembers the product picked earlier for the same words', () => {
    expect(hear('ek litre doodh', { milk: 'cow' }).lines[0]).toMatchObject({ product: 'cow', qty: 1 });
  });

  it('reads rupees as an amount', () => {
    expect(hear('200 ka dahi').lines[0]).toMatchObject({ product: 'dahi', total: 200, qty: 0.909 });
    expect(hear('sau rupay ka dahi').lines[0]).toMatchObject({ total: 100 });
    expect(hear('۵۰۰ روپے کا گائے کا دودھ').lines[0]).toMatchObject({ product: 'cow', total: 500 });
    // A big bare number on a weight item is money: nobody buys 200 kg of dahi by voice.
    expect(hear('dahi 200').lines[0]).toMatchObject({ total: 200 });
  });

  it('picks packs by name, size or the only pack', () => {
    expect(hear('ek darjan anday').lines[0]).toEqual({ product: 'egg', option: 'dz', qty: 1, total: 250 });
    expect(hear('teen anday').lines[0]).toEqual({ product: 'egg', option: 'base', qty: 3, total: 75 });
    expect(hear('ek tray').lines[0]).toMatchObject({ product: 'egg', option: 'tray' });
    expect(hear('do cup kheer').lines[0]).toMatchObject({ product: 'kheer', option: 'cup', qty: 2, total: 240 });
    expect(hear('aadha kilo kheer').lines[0]).toMatchObject({ option: 'tub', qty: 1 });
    expect(hear('ek kilo kheer').lines[0]).toMatchObject({ option: 'tub', qty: 2 });
    expect(hear('do kheer').lines[0]).toMatchObject({ choosePack: ['cup', 'tub'] });
    expect(hear('do kheer', { 'pack:kheer': 'cup' }).lines[0]).toMatchObject({ option: 'cup', qty: 2 });
    expect(hear('badam doodh ki do bottle').lines[0]).toMatchObject({ product: 'badam', option: 'bottle', qty: 2 });
    expect(hear('do rusk').lines[0]).toMatchObject({ product: 'rusk', option: 'r500', qty: 2, total: 520 });
    expect(hear('ek dabba muffin').lines[0]).toMatchObject({ product: 'muffin', option: 'box', qty: 1 });
    expect(hear('char muffin').lines[0]).toMatchObject({ product: 'muffin', option: 'base', qty: 4 });
  });

  it('tells similar products apart by size words', () => {
    expect(hear('ek bari double roti').lines[0]).toMatchObject({ product: 'bl', qty: 1, total: 240 });
    expect(hear('chhoti bread').lines[0]).toMatchObject({ product: 'bs' });
    expect(hear('bran bread').lines[0]).toMatchObject({ product: 'bran' });
    expect(hear('bara fruit cake').lines[0]).toMatchObject({ product: 'cakel' });
    expect(hear('bread').lines[0]).toMatchObject({ match: 'choose' });
    expect(hear('desi ghee aadha kilo').lines[0]).toMatchObject({ match: 'choose' });
    expect(hear('gaye ka desi ghee aadha kilo').lines[0]).toMatchObject({ product: 'cghee', qty: 0.5, total: 1750 });
  });

  it('splits several items in one sentence', () => {
    const { lines } = hear('do kilo dahi aur ek darjan anday aur 200 ka gaye ka doodh');
    expect(lines.map((l: any) => [l.product, l.qty])).toEqual([['dahi', 2], ['egg', 1], ['cow', 1.176]]);
    const noAnd = hear('do kilo dahi ek darjan anday').lines;
    expect(noAnd.map((l: any) => l.product)).toEqual(['dahi', 'egg']);
    const productFirst = hear('dahi do kilo anday ek darjan').lines;
    expect(productFirst.map((l: any) => [l.product, l.option, l.qty])).toEqual([['dahi', 'base', 2], ['egg', 'dz', 1]]);
    expect(hear('دو کلو دہی اور تین انڈے').lines.map((l: any) => [l.product, l.qty])).toEqual([['dahi', 2], ['egg', 3]]);
  });

  it('keeps unknown chatter inside the item', () => {
    expect(hear('taaza do kilo dahi').lines).toEqual([{ product: 'dahi', option: 'base', qty: 2, total: 440 }]);
  });

  it('finds commands', () => {
    expect(hear('save').command).toBe('save');
    expect(hear('bill bana do').command).toBe('save');
    expect(hear('بل بنا دو').command).toBe('save');
    expect(hear('do kilo dahi aur bill save karo')).toEqual({ command: 'save', lines: [{ product: 'dahi', option: 'base', qty: 2, total: 440 }] });
    expect(hear('ghalat').command).toBe('undo');
    expect(hear('dahi hata do').command).toBe('undo');
    expect(hear('band karo').command).toBe('stop');
    expect(hear('bill').command).toBeUndefined();
  });

  it('reports what it cannot sell', () => {
    expect(hear('do kilo anday').lines[0]).toMatchObject({ product: 'egg', problem: expect.stringContaining('not by weight') });
    expect(hear('ek darjan dahi').lines[0]).toMatchObject({ problem: expect.stringContaining('no dozen') });
    expect(hear('dedh cup kheer').lines[0]).toMatchObject({ problem: expect.stringContaining('whole numbers') });
    expect(hear('shukriya').lines[0]).toMatchObject({ match: 'none' });
  });

  it('reads plain English from the English recogniser', () => {
    expect(hear('2 kg yogurt and 1 dozen eggs').lines.map((l: any) => [l.product, l.qty])).toEqual([['dahi', 2], ['egg', 1]]);
    expect(hear('Rs. 500 cow milk').lines[0]).toMatchObject({ product: 'cow', total: 500 });
  });
});

describe('matchVoiceProduct', () => {
  const segment = (concepts: string[], words: string[] = []): VoiceSegment => ({ text: '', concepts, words, money: false });
  it('prefers the product that names exactly what was said', () => {
    expect(matchVoiceProduct(segment(['almond', 'milk']), products)).toEqual({ kind: 'one', productId: 'badam' });
    expect(matchVoiceProduct(segment(['egg']), products)).toEqual({ kind: 'one', productId: 'egg' });
  });
  it('fuzzy matches a catalog word the table does not know', () => {
    const kulfi = [...products, { id: 'kulfi', name: 'Pista Kulfi', unit: 'pcs' }];
    expect(matchVoiceProduct(segment([], ['kulfi']), kulfi)).toEqual({ kind: 'one', productId: 'kulfi' });
    expect(matchVoiceProduct(segment([], ['pistah']), kulfi)).toEqual({ kind: 'one', productId: 'kulfi' });
    expect(matchVoiceProduct(segment([], ['shukriya']), kulfi)).toEqual({ kind: 'none' });
  });
});
