# POS

The catalog uses readable product cards, a focused search field and single-category filters. On desktop, F2 selects product search; Enter opens the first available matching product and Arrow Down moves focus into the catalog. Successful quick entry returns focus to search. F4 opens customer search, F8 holds an order and F9 completes a sale. These shortcuts are suspended while an entry dialog is open.

On phones and tablets the catalog has no outer section box or heading. Product cards fill the available grid; search/category controls remain optional, and their header takes no space when both are hidden. Desktop retains its catalog heading and panel.

The quick entry dialog has separate amount and quantity modes, configured amount shortcuts, live conversion and remaining stock after the cart. Packaged variants use whole pack counts. On mobile it opens as a bottom sheet without automatically opening the phone keyboard. Direct input and a scrollable body leave the add button visible on short screens. Escape closes; Tab stays inside the dialog; background controls are inert until it closes. Reduced-motion preferences disable its entrance animation. Validation messages appear only when an entry needs attention.

Amount entries retain the entered currency total at two decimal places while quantities use the existing three-decimal precision. Combining an amount entry with a quantity entry retains the exact existing total. The quick entry sends stock deduction per unit, matching the existing cart model. Stock refusals keep the dialog open and show an error; success is only reported after the cart accepts an item.

Settings → Sales & Invoicing → POS Catalog has independent Show POS Search Bar and Show POS Product Categories switches. Both default to visible for existing installations and save through the existing sales-settings JSON. Hidden controls clear their filters so all products remain reachable. F2 moves focus to the first available product when search is hidden.

Quantity plus/minus controls in quick entry, cart and item editing use whole counts. A fractional amount/manual quantity moves to the next whole count in the chosen direction; manual fractional entry and exact amount calculations remain available. Quick quantity presets use whole numbers.

The mobile and tablet cart occupies the full viewport and places item details, quantity and total in one horizontal row. Desktop Expand cart opens the cart at full workspace width. Products returns to the catalog in either layout. Checkout, customer payment, held-order and receipt features remain available.

The quick entry dialog and the product detail page (Items) share one preset source, `getQuickPresets` in `src/lib/posQuickEntry.ts`, so the cash and quantity buttons a cashier sees are exactly the ones previewed on the product. Both modes have -/+ steppers (rupees step by the product's own shortcut size; quantities by whole counts), a stock and in-cart chip, a nearest clean weight suggestion for odd rupee amounts, and tap-again-to-add on any shortcut. On the product page every button starts that sale in POS (opened via POS ?quick=<id>&quickMode=&quickValue=).
