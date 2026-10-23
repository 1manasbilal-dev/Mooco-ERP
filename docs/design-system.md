# Mooco design system

One look for every screen: calm surfaces, one lime brand accent, clear numbers. This page is the contract for anyone building or restyling a screen.

- **Tokens:** `src/styles/tokens.css` (light and dark values)
- **Tailwind names:** `tailwind.config.js` (`bg-surface`, `text-fg-muted`, `border-line`, ...)
- **Components:** `src/components/ui/` (import from `src/components/ui`)
- **Live gallery (dev only, no login):** run `npm run dev` and open `/__ui`. Its source, `src/dev/UiGallery.tsx`, is the reference for putting a screen together.

## Principles

1. **Numbers first.** This is a money and stock app. Amounts are large, bold, `tabular-nums`, and always formatted with `Money` or `formatCurrency`. Colour carries meaning only: red = due/payable/loss, green = advance/paid/in, amber = warning, blue = info.
2. **One accent.** Lime (`brand`) marks the primary action and the current selection. Everything else is neutral. No rainbow cards.
3. **Quiet surfaces.** `canvas` behind, `surface` cards with a 1px `line` border and `shadow-e1`. Depth comes from elevation tokens, not from gradients, glow or blur.
4. **Touch friendly.** Controls are at least 40px tall (`h-10`) at the counter; POS targets 48px. Every icon-only button has an `aria-label`.
5. **Fast.** No `backdrop-blur` on large or scrolling surfaces, long lists paginate (`useProgressiveList` + `LoadMoreRow`), heavy panels and modals load lazily.

## Tokens

Use the Tailwind names, never hex values, and never pair them with `dark:` variants: the token already switches.

| Purpose | Class | Replaces (legacy) |
| --- | --- | --- |
| App background | `bg-canvas` | `bg-slate-50 dark:bg-slate-950` |
| Card / panel | `bg-surface` | `bg-white dark:bg-slate-900` |
| Inset, table head, input group | `bg-surface-2` | `bg-slate-50`, `bg-slate-100` |
| Hover / pressed fill | `bg-surface-3` | `hover:bg-slate-100`, `bg-slate-200` |
| Main text | `text-fg` | `text-slate-900 dark:text-white` |
| Secondary text | `text-fg-muted` | `text-slate-700`, `text-slate-600` |
| Labels, captions | `text-fg-subtle` | `text-slate-500`, `text-slate-400` |
| Placeholder, disabled icon | `text-fg-faint` | `text-slate-400`, `text-slate-300` |
| Border / divider | `border-line`, `divide-line` | `border-slate-200`, `border-slate-100` |
| Strong border (hover) | `border-line-strong` | `border-slate-300` |
| Primary fill | `bg-brand text-brand-on` (or `Button`) | `bg-lime-600 text-white` |
| Selected / soft accent | `bg-brand-soft text-brand-fg` | `bg-lime-50 text-lime-700` |
| Dots, chart series, highlights | `bg-brand-accent`, `text-brand-accent` | `bg-lime-500` |
| Focus ring | `ring-ring` | `ring-lime-500` |
| Status | `bg-{success,danger,warning,info}-soft text-{...}-fg`, solid `bg-{...}` | `bg-red-50 text-red-600`, `bg-emerald-50 text-emerald-700`, ... |
| Radius | `rounded-card` (16px) for cards, `rounded-control` (12px) for inputs/buttons | `rounded-2xl`, `rounded-xl` |
| Elevation | `shadow-e1` resting, `shadow-e2` hover/popover, `shadow-e3` modal | `shadow-sm`, `shadow-lg`, `shadow-2xl` |

Opacity works on every colour token: `bg-brand/10`, `border-danger/30`.

Workspace accents (cyan for milk, violet for products, rose for expenses) stay available for small identity touches such as a page icon chip, never for buttons or status.

## Components

| Component | Use for |
| --- | --- |
| `Button` | Every button. Variants `primary` (one per area), `secondary`, `ghost`, `soft`, `danger`, `danger-soft`; sizes `sm` `md` `lg`; `loading`, `leftIcon`, `rightIcon`, `fullWidth`. Defaults to `type="button"`. |
| `IconButton` | Icon-only actions (`aria-label` required, becomes the tooltip). |
| `Card`, `CardHeader`, `CardBody`, `CardFooter` | Content blocks. `variant="inset"` for panels inside a card, `interactive` for clickable cards. |
| `StatCard` | KPI tiles: label, value, icon, `tone`, `trend` (%), `trendGoodWhen="down"` for expenses/dues, `hint`, `loading`, `onClick`. |
| `Badge` | Status pills. `tone` + `soft`/`solid`, optional `dot`. |
| `Money` | Every rupee amount. `tone="balance"` (khata: positive due = red, negative advance = green), `tone="signed"` (cash flow), `compact`. |
| `PageHeader` | Top of a screen: `eyebrow`, optional `title` (the app header already shows the screen name), `description`, `actions`, and children for a tab/filter row. |
| `Toolbar` | Search + filters + actions row above a list. |
| `SearchInput` | Search with clear button, Esc to clear, `shortcut` hint. |
| `SegmentedControl` | Tabs and period pickers. `variant="pill"` for filters, `underline` for page sections. Arrow keys work. |
| `Field` + `Input` / `Select` / `Textarea` / `Label` | Forms. `Field` wires label, hint and error to the control (`{control => <Input {...control} />}`). `Input` takes `leftIcon` and `suffix` ("Rs", "L"). |
| `TableContainer`, `Table`, `THead`, `TBody`, `TR`, `TH`, `TD` | Data tables. `numeric` on money/quantity columns; `TR interactive selected`. |
| `EmptyState` | Empty lists: icon, what is missing, one action. `size="compact"` inside tables and side panels. |
| `Skeleton`, `SkeletonText` | Loading placeholders that match the final layout. Prefer them over spinners for page content. |
| `Modal`, `confirmAction` | Dialogs and confirmations (already shared before this system). |
| `cn()` from `src/lib/cn.ts` | Merge class names; later classes win. |

## Screen anatomy

```
PageHeader            eyebrow + description + primary action(s), tab/period row
StatCard grid         2 columns on phones, 4 on desktop (grid-cols-2 lg:grid-cols-4, gap-3)
Toolbar               SearchInput, filters (SegmentedControl), secondary actions, primary action
Content               TableContainer / Cards; EmptyState when empty; Skeleton while loading
```

- Page padding comes from the workspace container; inside a page use `gap-4`/`gap-6` between blocks, `p-4 sm:p-5` inside cards.
- Phones (390px wide) must work: no horizontal page scroll, tables scroll inside their container, toolbars wrap, primary action stays reachable.
- Headings: page `text-2xl font-bold tracking-tight`, card `text-[15px] font-bold`, labels `text-xs font-semibold text-fg-muted` in sentence case. Uppercase only for table heads and eyebrows.
- Copy keeps the app's existing English / Roman Urdu mix and business words (khata, due, advance, shift, drawer). Do not rename business terms.

## Motion

- 150 to 200ms, `ease-out-expo`, on colour, shadow and small transforms only. `animate-fade-up` for content that appears.
- Respect reduced motion (`useReducedMotion`); never animate layout of long lists.

## Performance rules for screens

- Derive filtered/sorted lists with `useMemo`; keep row components small and wrap them in `React.memo` when the list is long.
- Paginate long lists with `useProgressiveList` + `LoadMoreRow`.
- Lazy-load modals, drawers and print views (`React.lazy`) so they are not in the screen's first chunk.
- No `backdrop-blur` on cards or scroll containers; it is reserved for overlays.
- Do not create new objects or functions in props of memoised children without `useMemo`/`useCallback`.

## Migrating a legacy screen

`src/index.css` still holds a compatibility layer that repaints legacy classes (`bg-white`, `text-slate-*`, `border-slate-*`, ...) in dark mode with `!important`. When you migrate a screen:

1. Replace hand-rolled buttons, cards, badges, inputs and tables with the components above.
2. Replace remaining raw palette classes with token classes from the table, and delete their `dark:` twins.
3. Move any CSS that only your screen uses out of `src/index.css` into `src/styles/<area>.css`, imported by the screen.
4. Check light and dark at 1440px and 390px.

Once every screen is migrated, the compatibility layer in `src/index.css` can be deleted.

`src/theme.ts` (`MOOCO_THEME`) is legacy; new code uses `src/components/ui`.
