# Stock model

How product stock is stored, moved and shown. Every screen and every write follows these rules; the shared read helpers live in `src/lib/stockRules.ts` (built on `describeItemStock` in `src/lib/sellUnits.ts`).

## Where stock lives

All product stock is on the `items` row (there is no separate inventory table):

| Field | Meaning |
| --- | --- |
| `unit` | Base unit (kg, L, ml, pcs, ...). Cost price and reorder level are per base unit. |
| `stock` | **Loose pile**, in the base unit. |
| `variants[]` | Sell units. `quantity_in_base_unit` = base units inside one. |
| `variant_stocks[id]` | **Pack pile**: own count of a ready-made pack (`deduct_from_base !== true`). |
| `deduct_from_base: true` | **Multi-unit** (dozen, tray, 250 g scoop): a way to sell loose stock. Never holds its own count. |
| `allow_loose_sale` | Whether the loose pile can be sold directly (a multi-unit can still sell from it). |
| `reorder_level` | Low-stock alert level in the base unit. `0` / empty = no alert. |

The milk pool (collected milk not yet sent anywhere) is `allocations.remaining_quantity` in litres; counter milk becomes loose stock of the milk item once allocated. Milk items may be stocked in L or ml: always convert with `convertQuantity`.

## Reading stock (one rule each)

Use `readStock(item, looseStock, variantStocks)` from `src/lib/stockRules.ts`.

- **Total on hand** (`totalBase`): loose + every pack pile × its size, **hidden packs included** (it is physical stock). Multi-units add nothing.
- **Sellable now** (`sellableBase`): loose (only if loose sale is on or an active multi-unit exists) + **active** pack piles × size. Never below zero per pile.
- **Value**: positive piles × cost price per base unit, hidden packs included; negative piles are shown but valued at 0. `itemStockValue` in `stockProfit.ts` must agree with this.
- **Status** (`stockStatus`): `minus` if any loose/pack pile is below zero → `out` if nothing on hand or (sale products) nothing sellable → `low` if `reorder_level > 0` and total ≤ reorder level → `ok`. Inactive products get no alerts. This replaces the four different "low stock" rules (dashboard `?? 10`, inventory/catalog `|| 5`, report `> 0`).
- **Labels**: `sellableLabel` for POS cards ("8 500 g tub" only when one pack type is all that sells, else "16 kg"); `pileBreakdown` for details ("4 kg loose · 6 × 500 g tub · 2 × 1 kg tub (hidden)"). **Never add different pack sizes or hidden packs into one "N packs" number.**
- **Stray counts** (`strayCounts`): counts stored on a multi-unit or on a deleted pack. They are shown with a warning and must be clearable from a stock count (set to 0).
- **Rounding**: quantities to 3 decimals everywhere (`cleanQty`, `roundQuantity`, server `round(x, 3)`); money to 2; cost per base unit to 4.

## Moving stock

The only primitive is the `adjust_item_stock(item, loose_delta, variant_deltas)` RPC (row lock, deltas, 3-decimal rounding). Never write absolute stock numbers (`items.update({ stock })`), except a full reset.

| Flow | Pile it moves |
| --- | --- |
| Opening stock (new product, first count) | `setOpeningStock(itemId, { loose, packs })` in `useDairy()`: moves each pile to its target, one log with reason `Opening Stock`. |
| Supplies / material purchase | Bought in the base unit or a compatible unit → loose += qty × conversion. Bought as a ready-made pack → that pack pile += count. Moving-average cost uses total on hand before the intake. Return/delete reverses exactly what the purchase added (same pile). |
| Milk collection / milk return | Milk pool only. |
| Allocate to counter | Milk item loose += litres converted to the item's unit. |
| Counter milk to production, batch cancel | Loose −/+ converted quantity. |
| Production complete | Materials: from loose first, then from packs (whole packs, remainder back to loose); a recipe unit that can't be converted is an error, never a silent raw deduction. Outputs: loose += loose qty, packs += pack counts. |
| POS sale / customer order / delivery | A main-stock line (loose or multi-unit) takes qty × contains from loose; a pack line takes qty from its pack pile. The bill line snapshot (`stockDeduction`, `deductFromBase`, `variantId`) decides, so later catalog edits don't change old bills. |
| Sales return | Back to the pile it was sold from (snapshot), only up to what was sold minus already returned. |
| Stock count / audit / day close | Moves each pile by the difference to the counted number. Hidden packs and stray counts must be countable (to clear them). |
| Write-off / delete product | Zeroes every positive pile (loose and packs); hard delete only when all piles are 0. |

Every move writes one `inventory_logs` row: `difference` / `old_quantity` / `new_quantity` hold the **loose** base delta only; pack moves go in `details.variant_deltas: { [variantId]: delta }` (older rows: `details.variant_id` + `variant_delta`). Read logs only through `logStockDelta` / `logBaseDelta`.

## Product setup rules

- A ready-made pack's size can't change while it holds stock (count it to 0 first, or add a new pack). Changing the base unit is blocked while any pile holds stock.
- Hiding a pack that still holds stock is allowed but the stock stays visible in Inventory as "(hidden)" until counted or sold; tell the user so.
- A new product can be given opening stock right in the create form (loose and per pack).

## Screens that show stock (they must all use `stockRules`)

POS cards, quick-amount modal and cart guards; catalog pills and item detail; Inventory rows, audit dialog and day-close count; purchase item picker, landing preview and return limits; allocation and production material checks; dashboard low-stock card; inventory/valuation/movement reports and the balance-sheet stock value.
