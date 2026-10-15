import { UnitDefinition, UnitGroup } from '../types';

/**
 * Standard Built-in Measurement Units tailored for Dairy & Retail operations.
 * Includes Pakistani dairy metrics (Pao, Maund, Liters, Kg, Dozen, etc.)
 */
export const STANDARD_SYSTEM_UNITS: UnitDefinition[] = [
  // --- VOLUME (Liquid Measurement) ---
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

  // --- MASS / WEIGHT (Solid & Weighable Products) ---
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

  // --- COUNT / PACKAGING (Packaged & Discrete Items) ---
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
  milliliter: 'ml',
  milliliters: 'ml',
  mls: 'ml',
  kilogram: 'kg',
  kilograms: 'kg',
  kilo: 'kg',
  kilos: 'kg',
  gram: 'g',
  grams: 'g',
  gm: 'g',
  gms: 'g',
  paao: 'pao',
  paw: 'pao',
  paaon: 'pao',
  man: 'maund',
  mun: 'maund',
  mon: 'maund',
  piece: 'pcs',
  pieces: 'pcs',
  pc: 'pcs',
  units: 'unit',
  packet: 'pack',
  packets: 'pack',
  pkt: 'pack',
  pkts: 'pack',
  dozen: 'dz',
  dozens: 'dz',
  bottles: 'btl',
  bottle: 'btl',
  boxes: 'box',
  cartons: 'ctn',
  crates: 'crate',
  cups: 'cup',
  bags: 'bag',
  rolls: 'roll'
};

/** Normalize symbol string */
export const normalizeUnitSymbol = (symbol: string): string => {
  if (!symbol) return '';
  const clean = symbol.trim().toLowerCase();
  if (UNIT_ALIASES[clean]) return UNIT_ALIASES[clean];
  // Check against exact standard symbols preserving standard casing
  const match = STANDARD_SYSTEM_UNITS.find(u => u.symbol.toLowerCase() === clean);
  return match ? match.symbol : symbol.trim();
};

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
export const findUnitDefinition = (
  symbolOrId: string,
  customUnits: UnitDefinition[] = []
): UnitDefinition | undefined => {
  if (!symbolOrId) return undefined;
  const normalized = normalizeUnitSymbol(symbolOrId);
  const all = getAllAvailableUnits(customUnits);

  return (
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

/**
 * Converts a quantity from one unit to another within the same category.
 * Returns null if units are incompatible.
 */
export const convertQuantity = (
  quantity: number,
  fromSymbol: string,
  toSymbol: string,
  customUnits: UnitDefinition[] = []
): number | null => {
  if (!Number.isFinite(quantity)) return 0;
  if (fromSymbol.toLowerCase() === toSymbol.toLowerCase()) return quantity;

  const fromUnit = findUnitDefinition(fromSymbol, customUnits);
  const toUnit = findUnitDefinition(toSymbol, customUnits);

  if (!fromUnit || !toUnit) return null;
  if (fromUnit.type !== toUnit.type) return null; // Incompatible types

  const fromFactor = Number(fromUnit.factor) || 1;
  const toFactor = Number(toUnit.factor) || 1;

  // Convert to base unit first, then to target unit
  const inBase = quantity * fromFactor;
  const result = inBase / toFactor;

  return Math.round((result + Number.EPSILON) * 10000) / 10000;
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
    // If factor < 1 (e.g. 0.25 kg or 0.001 L)
    return `1 ${unit.symbol} = ${factor} ${base}`;
  }
};

/**
 * High-frequency quick selection badges for product form
 */
export const POPULAR_QUICK_UNITS = [
  { symbol: 'L', label: 'Liter', type: 'Volume' as const, categoryTag: 'VOL' },
  { symbol: 'kg', label: 'Kilogram', type: 'Mass' as const, categoryTag: 'MASS' },
  { symbol: 'pcs', label: 'Piece', type: 'Count' as const, categoryTag: 'QTY' },
  { symbol: 'pack', label: 'Pack', type: 'Count' as const, categoryTag: 'QTY' },
  { symbol: 'pao', label: 'Pao (250g)', type: 'Mass' as const, categoryTag: 'MASS' },
  { symbol: 'ml', label: 'Milliliter', type: 'Volume' as const, categoryTag: 'VOL' },
  { symbol: 'g', label: 'Gram', type: 'Mass' as const, categoryTag: 'MASS' },
  { symbol: 'dz', label: 'Dozen', type: 'Count' as const, categoryTag: 'QTY' },
  { symbol: 'maund', label: 'Maund (40kg)', type: 'Mass' as const, categoryTag: 'MASS' },
  { symbol: 'btl', label: 'Bottle', type: 'Count' as const, categoryTag: 'QTY' },
  { symbol: 'cup', label: 'Cup', type: 'Count' as const, categoryTag: 'QTY' }
];

/**
 * Variant Packaging Content presets (Tab 3: Variants)
 * Helps user instantly deduct the correct stock fraction without manual decimal math.
 */
export interface VariantStockPreset {
  label: string;
  qty: number;
  hint: string;
}

export const getVariantStockPresets = (baseUnit: string = 'kg'): VariantStockPreset[] => {
  const norm = (baseUnit || '').toLowerCase();

  if (norm === 'kg') {
    return [
      { label: '1 Pao (250g)', qty: 0.25, hint: 'Deducts 0.25 kg' },
      { label: 'Aadha Kg (500g)', qty: 0.5, hint: 'Deducts 0.5 kg' },
      { label: '3 Pao (750g)', qty: 0.75, hint: 'Deducts 0.75 kg' },
      { label: '1 Kilo (1 kg)', qty: 1.0, hint: 'Deducts 1 kg' },
      { label: 'Derh Kg (1.5 kg)', qty: 1.5, hint: 'Deducts 1.5 kg' },
      { label: '2 Kilo (2 kg)', qty: 2.0, hint: 'Deducts 2 kg' },
      { label: '5 Kilo (5 kg)', qty: 5.0, hint: 'Deducts 5 kg' }
    ];
  }

  if (norm === 'l' || norm === 'liter' || norm === 'liters') {
    return [
      { label: '250 ml (Quarter L)', qty: 0.25, hint: 'Deducts 0.25 L' },
      { label: '500 ml (Half L)', qty: 0.5, hint: 'Deducts 0.5 L' },
      { label: '1 Liter', qty: 1.0, hint: 'Deducts 1 L' },
      { label: '1.5 Liters', qty: 1.5, hint: 'Deducts 1.5 L' },
      { label: '2 Liters', qty: 2.0, hint: 'Deducts 2 L' },
      { label: '3 Liters', qty: 3.0, hint: 'Deducts 3 L' },
      { label: '5 Liters', qty: 5.0, hint: 'Deducts 5 L' }
    ];
  }

  // Count / Discrete products
  return [
    { label: '1 Unit / Pc', qty: 1, hint: 'Single item' },
    { label: 'Half Dozen (6)', qty: 6, hint: '6 items' },
    { label: '1 Dozen (12)', qty: 12, hint: '12 items' },
    { label: '1 Carton (24)', qty: 24, hint: '24 items' },
    { label: '50 Units', qty: 50, hint: '50 items' },
    { label: '100 Units', qty: 100, hint: '100 items' }
  ];
};
