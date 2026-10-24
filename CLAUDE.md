# Mooco ERP: notes for Claude

## Databases

- Live: Supabase project `kawpusbgmsfbhlmrpfjo` ("Mooco ERP"), real business data. Treat it as read-only: no SQL writes, migrations or edge-function deploys there unless the owner asks for that specific change.
- Test: `qsztaanbendzbhddwied` ("Mooco ERP Test"), same schema, no business data. Cloud sessions and branch previews use it; try new migrations here first.
- Every schema change goes in `supabase/migrations/`, so test and live stay in step.

## Branches and deploys

- A push or merge to `main` deploys erp.mooco.pk (Hostinger, `.github/workflows/deploy.yml`). Work on a branch; every pushed branch gets a Cloudflare Pages preview on the test database. See docs/cloud-setup.md.

## Talking to the owner

- The owner reads Roman Urdu. Ask questions in short, simple Roman Urdu.
