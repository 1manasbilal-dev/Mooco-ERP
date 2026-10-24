# Cloud par kaam aur live preview (Mooco ERP)

Is setup se Claude ke sessions aapke PC ki jagah cloud par chalte hain, aur har branch ka ek
preview link banta hai jo phone ya PC par khul jata hai. Aapke PC par load nahi parta.

```
Cloud session (claude.ai/code)  →  branch GitHub par push  →  Cloudflare preview link
                                                           →  theek ho to main mein merge  →  erp.mooco.pk (live)
```

## Do database

| Naam | Project ID | Kis ke liye |
|---|---|---|
| **Mooco ERP** (live) | `kawpusbgmsfbhlmrpfjo` | Asli data. Sirf erp.mooco.pk isay use karta hai. |
| **Mooco ERP Test** | `qsztaanbendzbhddwied` | Wohi tables aur functions, lekin asli data nahi. Cloud sessions aur preview links isay use karte hain. |

Test database ka kharcha $10 mahana hai (Supabase).

## Ek dafa ka setup

### 1. Repo private karein
GitHub par **Mooco-ERP** kholein → **Settings** → neeche **Danger Zone** → **Change visibility** → **Private**.

### 2. Claude ko GitHub se jorein
[claude.ai/code](https://claude.ai/code) kholein → GitHub connect karein → Claude GitHub App ko
**Mooco-ERP** repo ka access dein.

### 3. Cloud environment banayein
claude.ai/code par environment ki setting kholein → **Add environment**:

- **Name:** `Mooco ERP`
- **Network access:** Trusted
- **Environment variables** (yeh test database ki public keys hain):

  ```
  VITE_SUPABASE_URL=https://qsztaanbendzbhddwied.supabase.co
  VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFzenRhYW5iZW5kemJoZGR3aWVkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI4MzYwMTMsImV4cCI6MjEwODQxMjAxM30.d0bzIcc1ef_6UryhIrd0cPiJpngFutbyBZRIzacuFkc
  ```
- **Setup script:** khali chhor dein. `npm ci` khud chalta hai
  (`.claude/settings.json` → `scripts/cloud-session-start.sh`).

### 4. Preview links (Cloudflare Pages, free)
1. [dash.cloudflare.com](https://dash.cloudflare.com) par free account banayein.
2. **Workers & Pages** → **Create** → **Pages** → **Connect to Git** → GitHub connect karein → **Mooco-ERP** chunein.
3. Build settings:
   - **Project name:** `mooco-erp`
   - **Production branch:** `main`
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
4. **Environment variables** mein upar wale dono `VITE_SUPABASE_URL` aur `VITE_SUPABASE_ANON_KEY` (test wale)
   daalein, aur `NODE_VERSION` = `20` bhi. Production aur Preview dono mein test wale hi rakhein:
   Cloudflare par sab kuch test database par chalega, asli website Hostinger par hi rahegi.
5. **Save and Deploy**.

Is ke baad har branch ka link khud banta hai: `https://<branch-ka-naam>.mooco-erp.pages.dev`.
Pull request par Cloudflare link ka comment bhi kar deta hai.

## Roz ka kaam

1. Desktop app mein naya session → **Local** ki jagah **Cloud** → repo **Mooco-ERP** → environment
   **Mooco ERP** → branch chunein (jaise `feat/ui-next-level`).
2. Claude ko kaam batayein. Woh apni branch par kaam karke GitHub par push karta hai.
3. 1–2 minute baad Cloudflare ka preview link kholein aur check karein.
4. Theek ho to pull request ko `main` mein merge karein. Merge hote hi `deploy.yml` live website
   (erp.mooco.pk) update kar deta hai.

Kaam PC par laana ho to: `git pull`, ya session ke menu se **Open in → Terminal**.

## Ehtiyat

- `main` mein merge = live website badal jati hai. Sirf check kiya hua kaam merge karein.
- Nayi migration pehle **Mooco ERP Test** par chalayein, phir live par.
- Test database mein asli data nahi hai. Login ke liye neeche wala hissa dekhein.

## Test database mein login

Test database mein 5 roles (Owner, Manager, Cashier, Procurement, Production) aur settings ki row
pehle se maujood hain. Sirf apna owner login banana hai, ek dafa:

1. [Supabase dashboard](https://supabase.com/dashboard) → **Mooco ERP Test** → **SQL Editor**.
2. Neeche wali SQL paste karein, `1234` ki jagah apna 4–10 digit ka test PIN likhein, **Run** dabayein:

   ```sql
   insert into public.app_users (id, name, username, role_id, pin_salt, pin_hash)
   select 'user_owner', 'Owner', 'owner', 'role_super_admin', s,
          encode(extensions.digest(s || '1234', 'sha256'), 'hex')
   from (select encode(extensions.gen_random_bytes(16), 'hex') s) x;
   ```
3. Preview link par `owner` aur yeh PIN se login karein. Pehle login par Auth user khud ban jata hai.

Baqi log (cashier waghera) app ke andar **User management** se banayein. POS ya cash test karne hon
to pehle app mein ek bank/cash account bana lein.

Edge functions (`operator-login`, `mooco-insights-read`) test project par bhi lag chuke hain aur
koi alag secret nahi mangte.
