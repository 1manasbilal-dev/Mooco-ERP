# Database security: operator sessions instead of the open anon key

## Asaan alfaaz mein

**Masla:** app Supabase mein kabhi login nahi karti thi. Browser ke andar jo "anon key" hai (har
koi JS file se nikaal sakta hai), usi se saari tables padhi aur badli ja sakti thin — sales,
customers, bank, khata, sab. Matlab key wala koi bhi banda poori books dekh ya badal sakta tha.

**Hal:** ab PIN login ke baad server (Edge Function `operator-login`) us operator ko ek asli
Supabase session deta hai. Database sirf usi request ko jawab deta hai jis ke saath kisi **active**
operator ka session ho. Sirf anon key se ab sirf do cheezen chalti hain:

1. Login screen ke user tiles (sirf naam, tasveer, role — PIN/username/phone nahi).
2. Delivery app ka `sync_delivery_order` (yeh apni API key khud check karta hai).

Operator ko deactivate karte hi uska session foran bekaar ho jata hai.

## How it works

```
Login screen ──PIN──▶ Edge Function operator-login (service_role)
                        ├─ app_login / app_login_with_pin / app_verify_pin  (hashed, rate-limited)
                        └─ sign in Auth user  <app_users.auth_user_id>@operators.mooco.pk
                           (password = HMAC(server secret, auth uuid); never leaves the function)
                   ◀── access + refresh token
Browser: supabase.auth.setSession(...)  → persisted in localStorage "mooco-operator-auth"
Every REST/RPC call ─▶ PostgREST
                        ├─ pre-request gate app_private.check_request()   (fail-closed)
                        ├─ table RLS: to authenticated using app_private.is_operator()
                        └─ function grants: authenticated only (anon: 2 functions)
```

* `app_private.is_operator()` = the JWT's `auth.uid()` belongs to an `app_users` row with
  `is_active`. Random people who use the public Auth sign-up endpoint get a JWT, but no
  `app_users` row, so they see nothing and the gate rejects them.
* `app_private` is not exposed by the Data API, so its helpers cannot be called directly.
* User admin RPCs (`app_create_user`, `app_update_user`, `app_delete_user`) now require the
  `user_management` permission, and only a Super Admin can create/edit/delete a Super Admin.
  `app_roles` is readable by operators but writable only by the Owner / Super Admin
  (`20261023119000_app_roles_owner_only.sql`; before that, by user managers except their own role).
* The all-or-nothing money RPCs (`20261023110000` .. `20261023118000`: sales return, milk return,
  write-off / settle, expense edit, day close, journal voucher, bank entry, new account, daily
  supply) check the operator's role rights on the server (`app_private.can_perform`, the client's
  `canPerform` rule) and refuse dates inside the closed books or on a locked day
  (`app_private.assert_books_open`). Tables are still open to every operator (see the gaps below).
* The three PIN RPCs are callable only by `service_role` (the Edge Function).

## Files

| What | Where |
| --- | --- |
| Phase 1 migration (non-breaking) | `supabase/migrations/20261019170000_operator_auth_prep.sql` |
| Phase 2 migration (the lockdown) | `supabase/migrations/20261019171000_operator_auth_lockdown.sql` |
| Edge Function | `supabase/functions/operator-login/index.ts` (deploy with `verify_jwt = false`) |
| Client sign-in helpers | `src/lib/operatorAuth.ts`, `src/lib/supabase.ts` (session now persisted) |
| Login / restore / logout | `src/context/DairyContext.tsx` (`restoreOperator`, `signInOperator`, `logoutUser`, SIGNED_OUT listener) |
| Offline outbox | `src/lib/syncService.ts` (no sync without a session), `src/lib/syncErrors.ts` (auth errors are retryable, never dead-lettered) |

### Client behaviour changes

* No more "auto-select Super Admin" when the device has no saved user: a PIN is always needed.
* Signed out: the workspace load is skipped (cached data stays), only the login tiles load.
  The first successful login loads the workspace and pushes the offline queue.
* Offline with a saved session: the cached operator keeps working; supabase-js refreshes the token
  and the outbox syncs when the connection returns.
* If the refresh token is revoked/expired, Supabase emits `SIGNED_OUT` and the terminal locks.
* Switching user mints a new session for the new operator. Logout clears the session.

## Rollout order (each step is safe on its own)

1. **Apply phase 1** (`operator_auth_prep`). Adds `app_users.auth_user_id`, the helpers and
   `app_login_directory`. Nothing is revoked; the current live app keeps working.
2. **Deploy the Edge Function** `operator-login` (`verify_jwt: false`). Optional: set an
   `OPERATOR_SESSION_SECRET` function secret (any long random string). Without it the service key
   is used; rotating either is safe (the next login repairs the derived password).
3. **Deploy the new web build** to erp.mooco.pk. It works against both the old and the locked DB.
   Every device must log in once with its PIN (the old "remembered" login has no session).
4. **Apply phase 2** (`operator_auth_lockdown`). From now on the anon key alone gets nothing.
   Any device still running an old build must reload.
5. **Dashboard (recommended):** Authentication → Sign In / Providers → turn off
   "Allow new users to sign up". The gate already blocks sign-ups, this removes the noise.
   Operator Auth users are created with the admin API, which works with sign-ups disabled.

### Verify after phase 2 (anon key only)

```bash
# Expect 401 {"code":"MOOCO401"} for tables and money RPCs:
curl -s "$URL/rest/v1/sales?select=id&limit=1" -H "apikey: $ANON" -H "Authorization: Bearer $ANON"
curl -s -X POST "$URL/rest/v1/rpc/adjust_account_balance" -H "apikey: $ANON" -H "Authorization: Bearer $ANON" -H "Content-Type: application/json" -d '{"p_account_id":"x","p_delta":0}'
# Expect 200 with names only:
curl -s -X POST "$URL/rest/v1/rpc/app_login_directory" -H "apikey: $ANON" -H "Authorization: Bearer $ANON" -H "Content-Type: application/json" -d '{}'
```

Then log in on the app with a PIN and check: dashboard loads, a POS sale saves, an offline sale
syncs after reconnect, Settings → Users works for the owner and is refused for a cashier.

### Tested before applying

Both migrations were run on a local Postgres (PGlite) copy of the relevant schema with Supabase's
roles: 44/44 checks passed — anon blocked from tables, money RPCs, PIN RPCs and user admin;
login directory leaks no PIN/username/phone; delivery RPC still works with its key; random
sign-ups see 0 rows; deactivated operators lose access at once; cashiers cannot create users or
edit roles; the gate allows only service_role, active operators and the two public RPCs;
functions/tables created later are not anon-accessible. Phase 1 alone keeps the old app working.

## Rules for future migrations

* Never `grant ... to anon`. Grant new functions to `authenticated` (it is the default for new
  public functions now) and new tables get the same policy:
  `create policy operator_full_access on public.<t> for all to authenticated using ((select app_private.is_operator())) with check ((select app_private.is_operator()));`
* Several migrations from 2026-10-19 (`change_sale_payment_mode`, `post_customer_order_advance`,
  `process_sales_return`, `delete_supplier_transaction_effects`, `checkout_customer_order`) end
  with `grant execute ... to anon, authenticated`. Phase 2 revokes those grants and the gate blocks
  anon regardless, but re-running such a migration later re-adds the anon grant — change those
  lines to `to authenticated` when they are next edited (`20261023111000` already restates
  `process_sales_return` as `authenticated, service_role`).
* A money flow that writes more than one row belongs in one SECURITY DEFINER function: lock the
  rows it reads, take an idempotency id from the client, post cash/bank through
  `app_private.post_bank_tx` (balance and ledger row together), check rights with
  `app_private.assert_can` and dates with `app_private.assert_books_open`. Add PGlite checks to
  `supabase/tests/pglite/run.mjs` (happy path, same id twice, failure in the middle, permission).

## Rollback (emergency only — reopens the hole)

```sql
alter role authenticator reset pgrst.db_pre_request;
notify pgrst, 'reload config';
-- then, per table, re-create the old open policy, e.g.:
-- create policy "Public access policy" on public.sales for all using (true) with check (true);
-- grant select, insert, update, delete on all tables in schema public to anon;
-- grant execute on all functions in schema public to anon;
```
Removing only the pre-request line is the first lever if logins work but requests fail.

## Known gaps / follow-ups

* All operators share the same data access (a cashier's session can still read bank tables via
  the API). Per-module RLS (role permissions in policies) is the next step.
* PINs are SHA-256 with a salt, 4 digits; `app_login_with_pin` locks PIN-unlock for everyone after
  8 wrong tries in 15 min (one attacker can block it). Consider per-IP limits in the Edge Function
  and bcrypt (`crypt()`), and longer PINs for admins.
* `sync_delivery_order` compares the API key in plain text and has no rate limit; store a hash.
* `mooco-insights-read` (Edge Function) uses the service key behind its own token check; unchanged.
