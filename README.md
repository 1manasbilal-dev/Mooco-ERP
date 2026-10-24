# Mooco ERP

Point-of-sale and accounting system for a dairy business: milk procurement and allocation, production batches, POS with offline sales, cash custody (shifts, drawers, day close), customer and supplier khata, expenses, bank/cash accounts and reporting.

**Stack:** React 19, TypeScript, Vite 6, Tailwind CSS 3, Supabase (Postgres, Auth, Edge Functions), Dexie (IndexedDB), Recharts, Framer Motion.

## Getting started

Requires Node.js 20 or later.

```bash
npm install
cp .env.example .env.local   # set the Supabase URL and anon key
npm run dev                  # http://localhost:3000
```

| Variable | Purpose |
| --- | --- |
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase publishable (anon) key |

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the development server |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run typecheck` | Type-check the app and build config |
| `npm run lint` | Run ESLint |
| `npm run format` | Format the codebase with Prettier |
| `npm run package:hostinger` | Build and zip `dist/` into `release/mooco-erp-hostinger.zip` for manual upload |

## Project structure

```
src/
  main.tsx            Application entry point
  App.tsx             Shell: routing, workspace tabs, sidebar, lock screen
  pages/              One module per screen (POS, Customers, Suppliers, Cash Control, Reports, ...)
  components/         Shared and feature-specific UI, grouped by feature
    ui/               Generic primitives (Modal, ConfirmDialog, ...)
  context/            DairyContext (data and business operations), tabs, toasts
  hooks/              Reusable React hooks
  lib/                Domain logic, Supabase client, offline sync, formatting
    reports/          Report registry, definitions and exporters
  types.ts            Shared domain types
  theme.ts            Shared design tokens
supabase/
  migrations/         Database schema, RPCs and security policies (applied in order)
  functions/          Edge Functions (operator-login)
  scripts/            One-off data repair scripts, kept for audit
scripts/              Build and packaging scripts
docs/                 Feature and operations documentation
```

## Database

Migrations live in `supabase/migrations/` and are applied in filename order with the Supabase CLI (`supabase db push`) or the dashboard SQL editor. Business rules that move money or stock (balances, POS order effects, returns, customer order checkout) run inside Postgres functions so they are atomic and idempotent; the client never does read-modify-write on balances.

The `operator-login` Edge Function exchanges a PIN login for a Supabase Auth session. All tables and business RPCs require an active operator session. See [docs/security.md](docs/security.md).

A second project, **Mooco ERP Test** (`qsztaanbendzbhddwied`), has the same schema and no business data. Cloud sessions and branch previews use it; try new migrations there before live.

## Offline behaviour

POS sales and new customers are written to IndexedDB first and synced in the background with retries, a dead-letter queue and a cross-tab lock. Order side effects (stock, cash, khata) are applied by the idempotent `pos_sync_order_effects` RPC, so retries never double-post. Other modules require a connection.

## Deployment

Pushing to `main` runs the GitHub Actions workflow in `.github/workflows/deploy.yml`, which builds the app and uploads `dist/` to Hostinger over FTP. The workflow needs these repository secrets: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `FTP_SERVER`, `FTP_USERNAME`, `FTP_PASSWORD`.

Every other pushed branch gets a Cloudflare Pages preview at `https://<branch>.mooco-erp.pages.dev`, built against the test project. Setup and the daily cloud-session flow: [docs/cloud-setup.md](docs/cloud-setup.md).

## Documentation

- [Design system](docs/design-system.md): tokens, UI components and screen rules (live gallery at `/__ui` in dev)
- [Cash control](docs/cash-control.md): cashier shifts, handovers, remittances and day close
- [POS](docs/pos.md): catalog, quick entry and keyboard shortcuts
- [Customer orders](docs/customer-orders.md): bookings and billing through POS
- [Stock-based profit](docs/stock-profit.md): how the actual profit report is calculated
- [Security](docs/security.md): operator sessions and database access model
- [QA checklist](docs/qa-checklist.md): manual test plan by workflow
- [Cloud setup](docs/cloud-setup.md): cloud sessions, test database and branch previews (Roman Urdu)
