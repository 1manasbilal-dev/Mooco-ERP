# Mooco Dairy - Global Theme & Brand Aesthetic Rule

## Core Directives:
1. **Single Source of Truth:**
   - Always reference `theme.ts` and `index.css` for all colors, buttons, inputs, tables, tabs, and modal components.
   - Never introduce unapproved ad-hoc color overrides (e.g. random blues, purples, or unrelated greens).

2. **Official Mooco Brand Palette:**
   - **Primary Brand Accent:** `lime-600` (`#65a30d`), `lime-500` (`#84cc16`), `lime-700` (`#4d7c0f`), `lime-50` (`#f7fee7`).
   - **Backgrounds:** Clean `slate-50` body, crisp `white` cards with `slate-200` borders.
   - **Text:** Crisp `slate-900` / `slate-800` headers and `slate-600` body text.
   - **Financial Balances:** `red-600` (Due/Baqaya), `emerald-700` (Advance/Peshgi), `slate-500` (Settled).

3. **Standard Switch Tabs:**
   - The segmented switch (`Milk Varieties` vs `Other Products`) in `Purchase.tsx` must use `MOOCO_THEME.tab.container` and `MOOCO_THEME.tab.item`.

4. **Consistency Enforcement:**
   - When modifying any page (`Purchase.tsx`, `Customers.tsx`, `Allocation.tsx`, `Production.tsx`, `POS.tsx`, `Suppliers.tsx`), verify that component styles are imported or match `theme.ts` exactly.
