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

The milk pool (collected milk not yet sent anywhere) is `allocations.remaining_quantity` in litres; counter milk becomes loose stock of the milk item once allocated. Milk items may be stocked in L or ml: always convert with `convertQuantity` (or `litresToStockUnit` / `stockUnitToLitres` in `retailMilkStock.ts`). A conversion between unit groups (kg ↔ L) or to an unknown unit returns `null`: stop with a message, **never fall back to the raw number**.

## Reading stock (one rule each)

Use `readStock(item, looseStock, variantStocks)` from `src/lib/stockRules.ts`. Take `looseStock` / `variantStocks` from `stockCountsOf(item, inventoryRow)` (the live inventory row wins, the catalog row fills gaps).

- **Total on hand** (`totalBase`): loose + every pack pile × its size, **hidden packs included** (it is physical stock). Multi-units and stray counts add nothing. Negative piles count as they are.
- **Sellable now** (`sellableBase`): loose (only if loose sale is on or an active multi-unit exists) + **active** pack piles × size. Never below zero per pile.
- **Value**: positive piles × cost price per base unit, hidden packs included; negative piles are shown but valued at 0. `itemStockValue` in `stockProfit.ts` gives the same number (its `packs[]` lists hidden packs too, with `isActive: false`); `getRetailMilkStock` follows the same rule for counter milk.
- **Average-cost base** (`stockOnHandBase`): like the total, but each negative pile counts as 0, so a shortfall never dilutes the moving average at intake. Use it only for `averageCostAfterIntake`.
- **Status** (`stockStatus`): `minus` if any loose/pack pile is below zero → `out` if nothing on hand or (sale products) nothing sellable → `low` if `reorder_level > 0` and total ≤ reorder level → `ok`. `readStock().alert` is true only for active products whose status is not `ok`: inactive products get no alerts. This replaces the four different "low stock" rules (dashboard `?? 10`, inventory/catalog `|| 5`, report `> 0`).
- **Labels**: `sellableLabel` for POS cards ("8 500 g tub" only when one pack type is all that sells, else "16 kg"); `pileBreakdown` for details ("4 kg loose · 6 × 500 g tub · 2 × 1 kg tub (hidden)"). **Never add different pack sizes or hidden packs into one "N packs" number.**
- **Stray counts** (`strayCounts`): counts stored on a multi-unit or on a deleted pack. They are shown with a warning, valued at 0, and cleared by a stock count (`stockCountMoves` moves any listed stray count to 0).
- **Rounding**: quantities to 3 decimals everywhere (`cleanQty`, `roundQuantity`, `convertQuantity`, server `round(x, 3)`); money to 2; cost per base unit to 4. Show stock with `formatBaseQty` (3 decimals); `formatQty`'s default of 2 decimals is for other numbers.

## Which pile a sell line uses (one rule)

`saleLineStock(line, item?)` in `sellUnits.ts` decides for cart lines, saved bill lines, returns and reports alike (`cartLineUsesMainStock`, `cartLineContains`, `reservedBaseQty`, `reservedPackQty` and the stock-profit report all call it):

1. No variant, a `'loose'` / `'base'` variant id, or `isLoose: true` → loose pile, 1 base unit per unit sold.
2. Otherwise the line's own `deductFromBase` flag (the bill snapshot) decides: `true` = multi-unit from loose (qty × `stockDeduction`), `false` = that ready-made pack's own count.
3. No flag → today's catalog variant (`deduct_from_base`), when the caller passes the item.
4. Neither → a ready-made pack. Size: the snapshot's `stockDeduction`, then the catalog size, then 1.

A return without its own snapshot takes it from the bill line it reverses. `saleItemSnapshot` always writes the flag for pack lines.

## Stock counts

`stockCountLines(readStock(...))` lists what a count (audit dialog, day close) must offer: loose, **every** ready-made pack (hidden ones marked) and every stray count. `stockCountMoves(reading, { loose, packs })` returns the differences to send to `adjust_item_stock`; piles left out don't move, unknown ids are ignored, stray counts go to 0.

## Moving stock

The only primitive is the `adjust_item_stock(item, loose_delta, variant_deltas)` RPC (row lock, deltas, 3-decimal rounding). Never write absolute stock numbers (`items.update({ stock })`), except a full reset.

| Flow | Pile it moves |
| --- | --- |
| Opening stock (new product, first count) | `setOpeningStock(itemId, { loose, packs })` in `useDairy()`: moves each pile to its target, one log with reason `Opening Stock`. |
| Supplies / material purchase | Bought in the base unit or a compatible unit → loose += qty × conversion. Bought as a ready-made pack → that pack pile += count. Moving-average cost uses total on hand before the intake. Return/delete reverses exactly what the purchase added (same pile). |
| Milk collection / milk return | Milk pool only. |
| Allocate to counter | Milk item loose += litres converted to the item's unit (`litresToStockUnit`); the cost rate per litre is divided by the same factor (`unitFactor`). |
| Counter milk to production, batch cancel | Loose −/+ converted quantity; batches stay in litres. |
| Production complete | Materials: from loose first, then from packs (whole packs, remainder back to loose); a recipe unit that can't be converted is an error, never a silent raw deduction. Outputs: loose += loose qty, packs += pack counts. |
| POS sale / customer order / delivery | A main-stock line (loose or multi-unit) takes qty × contains from loose; a pack line takes qty from its pack pile. The bill line snapshot (`stockDeduction`, `deductFromBase`, `variantId`) decides, so later catalog edits don't change old bills. |
| Sales return | Back to the pile it was sold from (snapshot), only up to what was sold minus already returned. |
| Stock count / audit / day close | Moves each pile by the difference to the counted number. Hidden packs and stray counts must be countable (to clear them). |
| Write-off / delete product | Zeroes every positive pile (loose and packs); hard delete only when all piles are 0. |

Every move writes one `inventory_logs` row: `difference` / `old_quantity` / `new_quantity` hold the **loose** base delta only; pack moves go in `details.variant_deltas: { [variantId]: delta }` (older rows: `details.variant_id` + `variant_delta`), and `details.loose_delta` repeats the loose delta. Read logs only through `logStockDelta` / `logBaseDelta` (pass the whole row: `id`, `item_id`, `notes` matter for old shapes). The client shift closing writes rows with no details whose id names the pile, `log_cnt_|log_spoil_|log_waste_|log_tea_<closingId>_<itemId>_<pile>`; for a pack pile their loose columns hold **that pack's count**, and `logStockDelta` reads them as a pack move. Two old shapes carry pack moves without naming the pack, and `logStockDelta` flags them with `unrecordedPacks` (show a warning, never guess):

- Old pack audits (notes "Variant Audit", no details) stored the **pack count change in the loose columns**: read as no loose move.
- The server day-close count (`dayclose_stock_count`, notes "· N variant adjustment(s)", no details) stores the right loose delta but only counts its pack moves: read the loose part, flag the packs. New day-close rows should write `details.variant_deltas`.

In the stock-profit report every log is replayed by pile (loose, each pack) through `logStockDelta`; a gain or loss is judged in base units (`logBaseDelta`); opening stock is an adjustment into each pile at cost (not a purchase); a stray dozen count is never a stock row.

## Product setup rules

- A ready-made pack's size can't change while it holds stock (count it to 0 first, or add a new pack). Changing the base unit is blocked while any pile holds stock.
- Hiding a pack that still holds stock is allowed but the stock stays visible in Inventory as "(hidden)" until counted or sold; tell the user so.
- A new product can be given opening stock right in the create form (loose and per pack).

## Screens that show stock (they must all use `stockRules`)

POS cards, quick-amount modal and cart guards; catalog pills and item detail; Inventory rows, audit dialog and day-close count; purchase item picker, landing preview and return limits; allocation and production material checks; dashboard low-stock card; inventory/valuation/movement reports and the balance-sheet stock value.
