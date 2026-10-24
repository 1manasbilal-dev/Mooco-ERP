import { UnitDefinition, UnitGroup } from '../types';
import { cleanQty } from './formatters';

/**
 * Built-in units, including Pakistani dairy measures (pao, maund, dozen).
 */
const STANDARD_SYSTEM_UNITS: UnitDefinition[] = [
  // Volume
  {
    id: 'u_sys_l',
    name: 'Liter',
    symbol: 'L',
    factor: 1,
    isBase: true,
    type: 'Volume',
    description: 'Standard metric liter (Base for volume)',
    isSystem: true
  },
  {
    id: 'u_sys_ml',
    name: 'Milliliter',
    symbol: 'ml',
    factor: 0.001,
    isBase: false,
    type: 'Volume',
    description: '1/1,000 of a liter',
    isSystem: true
  },
  {
    id: 'u_sys_maund_vol',
    name: 'Maund (Milk Vol)',
    symbol: 'man-vol',
    factor: 40,
    isBase: false,
    type: 'Volume',
    description: 'Traditional 40 Liters milk measure',
    isSystem: true
  },
  {
    id: 'u_sys_500ml',
    name: 'Half Liter (500ml)',
    symbol: '500ml',
    factor: 0.5,
    isBase: false,
    type: 'Volume',
    description: '0.5 Liter pack / bottle',
    isSystem: true
  },
  {
    id: 'u_sys_250ml',
    name: 'Quarter Liter (250ml)',
    symbol: '250ml',
    factor: 0.25,
    isBase: false,
    type: 'Volume',
    description: '0.25 Liter / 1 Glass / Cup',
    isSystem: true
  },

  // Weight
  {
    id: 'u_sys_kg',
    name: 'Kilogram',
    symbol: 'kg',
    factor: 1,
    isBase: true,
    type: 'Mass',
    description: 'Standard metric kilogram (Base for weight)',
    isSystem: true
  },
  {
    id: 'u_sys_g',
    name: 'Gram',
    symbol: 'g',
    factor: 0.001,
    isBase: false,
    type: 'Mass',
    description: '1/1,000 of a kilogram',
    isSystem: true
  },
  {
    id: 'u_sys_pao',
    name: 'Pao (250g)',
    symbol: 'pao',
    factor: 0.25,
    isBase: false,
    type: 'Mass',
    description: 'Traditional 250 grams (1/4 kg)',
    isSystem: true
  },
  {
    id: 'u_sys_500g',
    name: 'Aadha Kilo (500g)',
    symbol: '500g',
    factor: 0.5,
    isBase: false,
    type: 'Mass',
    description: 'Half kilogram (500 grams)',
    isSystem: true
  },
  {
    id: 'u_sys_maund',
    name: 'Maund / Mann (40kg)',
    symbol: 'maund',
    factor: 40,
    isBase: false,
    type: 'Mass',
    description: 'Traditional 40 kilograms',
    isSystem: true
  },
  {
    id: 'u_sys_tola',
    name: 'Tola',
    symbol: 'tola',
    factor: 0.01166,
    isBase: false,
    type: 'Mass',
    description: 'Traditional 11.66 grams',
    isSystem: true
  },

  // Count and packaging
  {
    id: 'u_sys_pcs',
    name: 'Piece / Piece',
    symbol: 'pcs',
    factor: 1,
    isBase: true,
    type: 'Count',
    description: 'Single discrete unit',
    isSystem: true
  },
  {
    id: 'u_sys_unit',
    name: 'Unit / Piece',
    symbol: 'unit',
    factor: 1,
    isBase: false,
    type: 'Count',
    description: 'Generic discrete piece',
    isSystem: true
  },
  {
    id: 'u_sys_pack',
    name: 'Pack / Packet',
    symbol: 'pack',
    factor: 1,
    isBase: false,
    type: 'Count',
    description: 'Single sealed pack / pouch',
    isSystem: true
  },
  {
    id: 'u_sys_dz',
    name: 'Dozen',
    symbol: 'dz',
    factor: 12,
    isBase: false,
    type: 'Count',
    description: '12 items',
    isSystem: true
  },
  {
    id: 'u_sys_hdz',
    name: 'Half Dozen',
    symbol: 'h-dz',
    factor: 6,
    isBase: false,
    type: 'Count',
    description: '6 items',
    isSystem: true
  },
  {
    id: 'u_sys_btl',
    name: 'Bottle',
    symbol: 'btl',
    factor: 1,
    isBase: false,
    type: 'Count',
    description: 'Bottle container',
    isSystem: true
  },
  {
    id: 'u_sys_box',
    name: 'Box / Dabba',
    symbol: 'box',
    factor: 1,
    isBase: false,
    type: 'Count',
    description: 'Box packaging',
    isSystem: true
  },
  {
    id: 'u_sys_ctn',
    name: 'Carton (24 pcs)',
    symbol: 'ctn',
    factor: 24,
    isBase: false,
    type: 'Count',
    description: 'Master carton of 24 pieces',
    isSystem: true
  },
  {
    id: 'u_sys_crate',
    name: 'Crate (12 pcs)',
    symbol: 'crate',
    factor: 12,
    isBase: false,
    type: 'Count',
    description: 'Dairy bottle crate (12 units)',
    isSystem: true
  },
  {
    id: 'u_sys_cup',
    name: 'Cup / Bowl',
    symbol: 'cup',
    factor: 1,
    isBase: false,
    type: 'Count',
    description: 'Kheer / Raita cup container',
    isSystem: true
  },
  {
    id: 'u_sys_bag',
    name: 'Bag / Bori',
    symbol: 'bag',
    factor: 1,
    isBase: false,
    type: 'Count',
    description: 'Bulk material bag',
    isSystem: true
  },
  {
    id: 'u_sys_roll',
    name: 'Roll',
    symbol: 'roll',
    factor: 1,
    isBase: false,
    type: 'Count',
    description: 'Packaging tape / foil roll',
    isSystem: true
  }
];

/** Unit aliases map to normalize user input (e.g., 'liter' -> 'L', 'kgs' -> 'kg') */
const UNIT_ALIASES: Record<string, string> = {
  liter: 'L',
  liters: 'L',
  litre: 'L',
  litres: 'L',
  l: 'L',
  lt: 'L',
  lts: 'L',
  ltr: 'L',
  ltrs: 'L',
  milliliter: 'ml',
  milliliters: 'ml',
  millilitre: 'ml',
  millilitres: 'ml',
  mls: 'ml',
  kilogram: 'kg',
  kilograms: 'kg',
  kilo: 'kg',
  kilos: 'kg',
  kgs: 'kg',
  gram: 'g',
  grams: 'g',
  gm: 'g',
  gms: 'g',
  grm: 'g',
  grms: 'g',
  paao: 'pao',
  paw: 'pao',
  paaon: 'pao',
  man: 'maund',
  mun: 'maund',
  mon: 'maund',
  piece: 'pcs',
  pieces: 'pcs',
  pc: 'pcs',
  nos: 'pcs',
  units: 'unit',
  packet: 'pack',
  packets: 'pack',
  pkt: 'pack',
  pkts: 'pack',
  dozen: 'dz',
  dozens: 'dz',
  doz: 'dz',
  dzn: 'dz',
  bottles: 'btl',
  bottle: 'btl',
  boxes: 'box',
  cartons: 'ctn',
  crates: 'crate',
  cups: 'cup',
  bags: 'bag',
  rolls: 'roll'
};

const normalizeUnitSymbol = (symbol: string): string => {
  if (!symbol) return '';
  const clean = String(symbol).trim().toLowerCase();
  if (UNIT_ALIASES[clean]) return UNIT_ALIASES[clean];
  // Standard symbols keep their own casing
  const match = STANDARD_SYSTEM_UNITS.find(u => u.symbol.toLowerCase() === clean);
  return match ? match.symbol : String(symbol).trim();
};

/** The standard spelling of a unit: 'Ltr' → 'L', 'kgs' → 'kg', 'ML' → 'ml'. Unknown names come back trimmed. */
export const normalizeUnit = (symbol?: string | null): string => normalizeUnitSymbol(symbol || '');

/**
 * Returns all active units combining system defaults and user custom units.
 */
export const getAllAvailableUnits = (customUnits: UnitDefinition[] = []): UnitDefinition[] => {
  const customMap = new Map<string, UnitDefinition>();
  customUnits.forEach(u => {
    if (u && u.symbol) {
      customMap.set(u.symbol.toLowerCase(), { ...u, isSystem: false });
    }
  });

  const merged: UnitDefinition[] = [];

  // Add system units (if not explicitly overridden by custom unit)
  STANDARD_SYSTEM_UNITS.forEach(sysUnit => {
    const key = sysUnit.symbol.toLowerCase();
    if (customMap.has(key)) {
      merged.push({ ...sysUnit, ...customMap.get(key)!, isSystem: false });
      customMap.delete(key);
    } else {
      merged.push(sysUnit);
    }
  });

  // Add remaining purely custom units
  customMap.forEach(customUnit => {
    merged.push(customUnit);
  });

  return merged;
};

/**
 * Builds structured UnitGroups (Volume, Mass, Count) for dropdowns and manager views.
 */
export const buildStandardUnitGroups = (customUnits: UnitDefinition[] = []): UnitGroup[] => {
  const allUnits = getAllAvailableUnits(customUnits);

  const volumeUnits = allUnits.filter(u => u.type === 'Volume');
  const massUnits = allUnits.filter(u => u.type === 'Mass');
  const countUnits = allUnits.filter(u => u.type === 'Count');

  return [
    {
      id: 'ug_vol',
      name: 'Liquid & Volume (L, ml, Maund)',
      baseUnitSymbol: 'L',
      units: volumeUnits
    },
    {
      id: 'ug_mass',
      name: 'Weight & Mass (kg, g, Pao, Maund)',
      baseUnitSymbol: 'kg',
      units: massUnits
    },
    {
      id: 'ug_count',
      name: 'Count & Packaging (pcs, pack, dz, box)',
      baseUnitSymbol: 'pcs',
      units: countUnits
    }
  ];
};

/**
 * Find unit definition by symbol or id
 */
const findUnitDefinition = (
  symbolOrId: string,
  customUnits: UnitDefinition[] = []
): UnitDefinition | undefined => {
  if (!symbolOrId) return undefined;
  const normalized = normalizeUnitSymbol(symbolOrId);
  const all = getAllAvailableUnits(customUnits);
  const raw = String(symbolOrId).trim().toLowerCase();

  return (
    // A unit's own symbol wins over an alias, so a custom 'ltr' or 'kgs' unit keeps its own factor.
    all.find(u => u.symbol.toLowerCase() === raw) ||
    all.find(u => u.symbol.toLowerCase() === normalized.toLowerCase()) ||
    all.find(u => u.id === symbolOrId) ||
    all.find(u => u.name.toLowerCase() === symbolOrId.toLowerCase())
  );
};

/**
 * Detect the appropriate unit group ID for a given unit symbol
 */
export const detectUnitGroupId = (
  symbol: string,
  customUnits: UnitDefinition[] = []
): string => {
  const unit = findUnitDefinition(symbol, customUnits);
  if (!unit) return 'ug_count';
  if (unit.type === 'Volume') return 'ug_vol';
  if (unit.type === 'Mass') return 'ug_mass';
  return 'ug_count';
};

/** Volume, Mass or Count for a known unit; null for a name the app does not know. */
export const unitTypeOf = (symbol?: string | null, customUnits: UnitDefinition[] = []): UnitDefinition['type'] | null =>
  findUnitDefinition(symbol || '', customUnits)?.type || null;

/**
 * Converts a quantity from one unit to another within the same category (L ↔ ml, kg ↔ g ↔ pao, dz ↔ pcs).
 * Returns null when the units are in different groups (kg vs L) or unknown: the caller must stop or ask,
 * never fall back to the raw number. The result keeps the stock precision of 3 decimals.
 */
export const convertQuantity = (
  quantity: number,
  fromSymbol: string,
  toSymbol: string,
  customUnits: UnitDefinition[] = []
): number | null => {
  if (!Number.isFinite(quantity)) return 0;
  const from = String(fromSymbol ?? '').trim();
  const to = String(toSymbol ?? '').trim();
  if (from.toLowerCase() === to.toLowerCase()) return cleanQty(quantity);

  const fromUnit = findUnitDefinition(from, customUnits);
  const toUnit = findUnitDefinition(to, customUnits);

  if (!fromUnit || !toUnit) return null;
  if (fromUnit.type !== toUnit.type) return null;

  const fromFactor = Number(fromUnit.factor) || 1;
  const toFactor = Number(toUnit.factor) || 1;

  // Convert to base unit first, then to target unit
  const inBase = quantity * fromFactor;
  const result = inBase / toFactor;

  return cleanQty(result);
};

/**
 * How many of `toSymbol` make one `fromSymbol` (1 L → 1000 ml), unrounded, for converting rates:
 * a price per L divided by this is the price per ml. Null when the units don't convert.
 */
export const unitFactor = (fromSymbol: string, toSymbol: string, customUnits: UnitDefinition[] = []): number | null => {
  const from = String(fromSymbol ?? '').trim();
  const to = String(toSymbol ?? '').trim();
  if (from.toLowerCase() === to.toLowerCase()) return 1;
  const fromUnit = findUnitDefinition(from, customUnits);
  const toUnit = findUnitDefinition(to, customUnits);
  if (!fromUnit || !toUnit || fromUnit.type !== toUnit.type) return null;
  return (Number(fromUnit.factor) || 1) / (Number(toUnit.factor) || 1);
};

/**
 * Human-friendly conversion formula text (e.g., "1 pao = 0.25 kg", "1 dz = 12 pcs")
 */
export const getUnitFactorDescription = (
  unit: UnitDefinition,
  baseSymbol?: string
): string => {
  const base = baseSymbol || (unit.type === 'Volume' ? 'L' : unit.type === 'Mass' ? 'kg' : 'pcs');
  if (unit.isBase || unit.symbol.toLowerCase() === base.toLowerCase()) {
    return `Base Standard (1 ${unit.symbol})`;
  }
  const factor = Number(unit.factor) || 1;
  if (factor >= 1) {
    return `1 ${unit.symbol} = ${factor} ${base}`;
  } else {
    return `1 ${unit.symbol} = ${factor} ${base}`;
  }
};

/**
 * Pack-size presets for variants, so the right stock fraction is deducted without decimal math.
 */
export interface VariantStockPreset {
  label: string;
  qty: number;
  hint: string;
}

/**
 * What a unit actually does in this app, in plain words for the owner.
 * - base: what stock, cost and price are counted in (kg, L, pcs)
 * - convertible: a weight/volume that converts exactly (g → kg, ml → L, pao, maund); used in recipes
 * - fixed-pack: a count with a fixed size (dozen = 12). Real pack sizes differ per product,
 *   so they belong in that product's Units & Packaging tab, not here.
 * - label: a count name with no size of its own (pack, box, bottle)
 */
export const describeUnitRole = (unit: UnitDefinition): { role: 'base' | 'convertible' | 'fixed-pack' | 'label'; label: string; hint: string } => {
  const factor = Number(unit.factor) || 1;
  if (unit.isBase) {
    return { role: 'base', label: 'Base', hint: 'Stock, cost and price are counted in this unit.' };
  }
  if (unit.type === 'Mass' || unit.type === 'Volume') {
    return { role: 'convertible', label: 'Converts', hint: 'Converted to the base unit in recipes.' };
  }
  if (factor !== 1) {
    return { role: 'fixed-pack', label: 'Fixed size', hint: "Pack sizes vary by product. Add dozens, trays and cartons in the product's Units & Packaging tab." };
  }
  return { role: 'label', label: 'Name only', hint: "Has no size of its own. Add packs in the product's Units & Packaging tab." };
};

/** A base unit should be the smallest thing you count or weigh. Dozen/carton as a base hides loose pieces. */
export const baseUnitWarning = (symbol: string, customUnits: UnitDefinition[] = []): string => {
  const unit = findUnitDefinition(symbol, customUnits);
  if (!unit) return '';
  const role = describeUnitRole(unit);
  if (role.role === 'fixed-pack') {
    return `Use pcs as the base unit and add ${unit.name} under Units & Packaging.`;
  }
  if (unit.type !== 'Count' && !unit.isBase && Number(unit.factor) > 1) {
    return `Use ${unit.type === 'Mass' ? 'kg' : 'L'} as the base unit; ${unit.symbol} is too large to count loose stock.`;
  }
  return '';
};
