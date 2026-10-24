import { formatQty } from './formatters';
import { sellUnitContains } from './sellUnits';

/**
 * Catalog edits that would misread stock already on the shelf (docs/stock-model.md, "Product setup
 * rules"). Stock is stored as counts: loose in the base unit, a ready-made pack as a number of packs.
 * Changing the base unit, a pack's size, or turning a pack into a dozen/tray (or deleting it) while
 * that pile holds stock silently changes what the count means.
 */
type SetupVariant = { id: string; name?: string; quantity_in_base_unit?: number; deduct_from_base?: boolean; isActive?: boolean };
type SetupItem = { name?: string; unit?: string | null; stock?: number | null; variant_stocks?: Record<string, number> | null; variants?: SetupVariant[] | null };

const EPS = 0.0005;
const held = (count: unknown) => Math.abs(Number(count) || 0) > EPS;
const isPack = (v?: SetupVariant) => Boolean(v) && v!.deduct_from_base !== true;

export interface SetupCheck {
  /** Blocks the save. */
  error?: string;
  /** The save is fine, but the owner should know (e.g. a hidden pack still holds stock). */
  notice?: string;
}

export function checkItemSetupChange(current: SetupItem, next: { unit?: string | null; variants?: SetupVariant[] | null }): SetupCheck {
  const name = current.name || 'Product';
  const unit = String(current.unit || '').trim() || 'unit';
  const counts = current.variant_stocks || {};
  const oldVariants = current.variants || [];
  const loose = Number(current.stock) || 0;

  if (next.unit !== undefined && next.unit !== null && String(next.unit).trim() !== String(current.unit || '').trim()) {
    const packsHeld = oldVariants.filter(v => isPack(v) && held(counts[v.id]));
    if (held(loose) || packsHeld.length > 0) {
      const what = [held(loose) ? `${formatQty(loose, 3)} ${unit} loose` : '', ...packsHeld.map(v => `${formatQty(Number(counts[v.id]) || 0, 3)} × ${v.name || 'pack'}`)].filter(Boolean).join(', ');
      return { error: `"${name}" ka stock abhi ${unit} mein hai (${what}). Base unit badalne se pehle stock count se 0 karein, warna purana stock naye unit mein ghalat parha jayega.` };
    }
  }

  if (!next.variants) return {};
  const nextVariants = next.variants;
  for (const old of oldVariants) {
    if (!isPack(old) || !held(counts[old.id])) continue;
    const count = formatQty(Number(counts[old.id]) || 0, 3);
    const label = old.name || 'Pack';
    const now = nextVariants.find(v => v.id === old.id);
    if (!now) {
      return { error: `"${label}" mein abhi ${count} pack stock hai. Pack hatane se pehle stock count se 0 karein, ya pack ko hide kar dein.` };
    }
    if (now.deduct_from_base === true) {
      return { error: `"${label}" ke ${count} pack stock mein hain. Isay dozen/tray jaisa unit (main stock se) banane se pehle stock count se 0 karein, ya naya unit banayein.` };
    }
    if (Math.abs(sellUnitContains(now) - sellUnitContains(old)) > EPS) {
      return { error: `"${label}" ka size ${formatQty(sellUnitContains(old), 3)} ${unit} se ${formatQty(sellUnitContains(now), 3)} ${unit} nahi ho sakta jab tak is mein ${count} pack stock hai. Pehle stock count se 0 karein, ya naya pack banayein.` };
    }
  }
  // A count left on a dozen/tray (or a deleted pack) would turn into real pack stock if that unit became a pack.
  for (const now of nextVariants) {
    if (!isPack(now) || !held(counts[now.id])) continue;
    const old = oldVariants.find(v => v.id === now.id);
    if (!isPack(old)) {
      return { error: `"${now.name || 'Unit'}" par purana count ${formatQty(Number(counts[now.id]) || 0, 3)} pada hai. Isay pack banane se pehle stock count mein 0 karein.` };
    }
  }

  const hiddenHeld = nextVariants.filter(v => isPack(v) && v.isActive === false && held(counts[v.id])
    && oldVariants.find(o => o.id === v.id)?.isActive !== false);
  if (hiddenHeld.length > 0) {
    return { notice: `${hiddenHeld.map(v => `"${v.name || 'Pack'}"`).join(', ')} hide ho gaya, lekin is ka stock (${hiddenHeld.map(v => formatQty(Number(counts[v.id]) || 0, 3)).join(', ')} pack) Inventory mein "(hidden)" dikhega jab tak bik na jaye ya count na ho.` };
  }
  return {};
}
