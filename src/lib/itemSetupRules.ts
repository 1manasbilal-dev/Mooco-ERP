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
      return { error: `"${name}" has stock in ${unit} right now (${what}). Set it to 0 with a stock count before changing the base unit, or the old stock will be read wrongly in the new unit.` };
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
      return { error: `"${label}" still has ${count} packs in stock. Set it to 0 with a stock count before removing the pack, or hide the pack instead.` };
    }
    if (now.deduct_from_base === true) {
      return { error: `"${label}" has ${count} packs in stock. Set it to 0 with a stock count before turning it into a dozen/tray-style unit (taken from main stock), or create a new unit.` };
    }
    if (Math.abs(sellUnitContains(now) - sellUnitContains(old)) > EPS) {
      return { error: `"${label}" can't change size from ${formatQty(sellUnitContains(old), 3)} ${unit} to ${formatQty(sellUnitContains(now), 3)} ${unit} while it holds ${count} packs of stock. Set it to 0 with a stock count first, or create a new pack.` };
    }
  }
  // A count left on a dozen/tray (or a deleted pack) would turn into real pack stock if that unit became a pack.
  for (const now of nextVariants) {
    if (!isPack(now) || !held(counts[now.id])) continue;
    const old = oldVariants.find(v => v.id === now.id);
    if (!isPack(old)) {
      return { error: `"${now.name || 'Unit'}" still has an old count of ${formatQty(Number(counts[now.id]) || 0, 3)}. Set it to 0 with a stock count before turning it into a pack.` };
    }
  }

  const hiddenHeld = nextVariants.filter(v => isPack(v) && v.isActive === false && held(counts[v.id])
    && oldVariants.find(o => o.id === v.id)?.isActive !== false);
  if (hiddenHeld.length > 0) {
    return { notice: `${hiddenHeld.map(v => `"${v.name || 'Pack'}"`).join(', ')} is hidden, but its stock (${hiddenHeld.map(v => formatQty(Number(counts[v.id]) || 0, 3)).join(', ')} pack) will show in Inventory as "(hidden)" until it is sold or counted.` };
  }
  return {};
}
