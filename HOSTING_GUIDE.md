# RAQBO — Hosting guide (step by step)

Two parts: **A. Supabase (database & sign-in)** and **B. put the website online**. Then **C. final settings**.

---

## A. Supabase (database & sign-in)

### If you ALREADY use the RAQBO Supabase project (usamujceckeghagaller)
Run the newest updates, one at a time (your data stays):
1. Supabase → **SQL Editor → New query**.
2. Open `supabase/updates/update_4_reviews.sql` in Notepad → **Ctrl+A**, **Ctrl+C** → paste into Supabase → **Run** → *Success*. (Skip if you already ran it.)
3. **New query** again → paste all of `supabase/updates/update_5_marketplace.sql` → **Run** → *Success*. (Adds Sell With Us & Order Online: vendors, buyers, escrow orders, vendor reviews, 6 sample shops.)
4. If you ran update_5 **before 6 Nov 2026 evening**, also run `update_6_nayapay.sql` (adds NayaPay) and `update_7_payment_proof.sql` (payment screenshots). Running update_5 now already includes both.
5. For order status emails, also run `update_8_order_emails.sql` (safe to run more than once; update_5 now includes it).

### If you are starting a NEW Supabase project
1. Create a project at **supabase.com** (free plan is fine).
2. **SQL Editor → New query** → paste all of `supabase/schema.sql` → **Run**.
3. **Project Settings → API**: copy the **Project URL** and the **anon public** key.
4. Open `website/index.html` in Notepad, press **Ctrl+F**, search `supabaseUrl` and replace the URL and the `supabaseAnonKey` value with yours. Save.

### Supabase settings (both cases)
| Where in Supabase | Set to |
|---|---|
| Authentication → Sign In / Providers → **Email** → Confirm email | **OFF** |
| Authentication → **Attack Protection** → Captcha | **OFF** |
| Authentication → **URL Configuration** → Site URL | your website address, e.g. `https://raqbo.pk` |
| Authentication → URL Configuration → **Redirect URLs** | add `https://raqbo.pk/**` (and your GitHub Pages / Netlify address + `/**`) |
| Authentication → Emails → **SMTP Settings** | Gmail: host `smtp.gmail.com`, port `465`, user `raqbo.official@gmail.com`, password = Gmail **App password** (needed for "Forgot password" emails) |
| Authentication → Sign In / Providers → **Google** (optional) | turn on and paste the Google OAuth Client ID & Secret |

### Make yourself admin
1. **Authentication → Users → Add user → Create new user** (your email + password, tick **Auto Confirm User**).
2. SQL Editor → run (change the email):
   ```sql
   update public.profiles set role = 'admin', verified = true, full_name = 'RAQBO Admin'
   where email = 'raqbo.official@gmail.com';
   ```
3. Open `yourwebsite/#admin` and sign in.

---

## B. Put the website online — choose ONE

> Always upload the **contents** of the `website` folder (so `index.html` is at the top level).

### Option 1 — raqbo.pk (cPanel hosting)
1. Log in to cPanel → **File Manager** → open **public_html**.
2. Click **Upload** and upload everything inside `website/` (or upload a zip of it and use **Extract**).
   Turn on "Show hidden files" in Settings so `.htaccess` is visible.
3. cPanel → **SSL/TLS Status** (or Let's Encrypt) → turn on free SSL for raqbo.pk.
4. Open **https://raqbo.pk** and press **Ctrl+F5**.

### Option 2 — Netlify (free, 2 minutes, no Git needed)
1. Go to **app.netlify.com/drop**.
2. Drag the `website` folder onto the page. You get a link like `https://raqbo-xxxx.netlify.app`.
3. To use raqbo.pk: Netlify → **Domain management → Add a domain** and follow the DNS steps.

### Option 3 — GitHub Pages (free)
1. Copy the contents of `website/` into your repository folder (`raqbo-repo`) and push:
   ```
   cd /d C:\Users\bombaytraders\Projects\raqbo-repo
   git add -A
   git commit -m "RAQBO website"
   git push origin main
   ```
2. GitHub → repository → **Settings → Pages** → Source **Deploy from a branch** → **main** / **(root)** → **Save**.
3. After 1–2 minutes: `https://syedhassan1214.github.io/Raqbo-construction-and-properties/`

---

## C. After it is online
0. **Escrow account:** open `website/content.js` and fill in `escrow` (bank, IBAN, JazzCash…) — this is the account buyers pay into. Upload again.
   Admin work for escrow orders is in the **Admin panel → SELL WITH US** section (Escrow payments, Disputes, Suppliers, Buyers, Material orders): confirm payments, release payouts, resolve disputes, approve suppliers, turn on Verified / Escrow, register commercial buyers.
1. Add the live address to Supabase **Redirect URLs** (section A) — needed for Google sign-in and password reset links.
2. Edit `website/content.js` with the real founder name, message and projects; put photos in `website/images/`; set `sample: false`. Upload again.
3. Optional admin email alerts: import `n8n/RAQBO_admin_alerts.n8n.json` into n8n and follow the yellow note inside the workflow (change `SECRET`, connect Gmail, create the Supabase database webhooks).
4. Order status emails: import `n8n/RAQBO_order_emails.n8n.json`, change `SECRET`, connect Gmail, activate it, then in Supabase → Database → Webhooks create a webhook on table **email_outbox**, event **Insert**, POST to the workflow's Production URL with header `x-raqbo-secret`. Every email that was queued can be seen in Table Editor → **email_outbox**.
4. Test: create an account, list a property, approve it from `#admin`, write a review, share a property link.

## Troubleshooting
| Message | Fix |
|---|---|
| "Demo website" banner / data only in this browser | Supabase library could not load — check internet, or the Supabase URL/key in index.html |
| "Couldn't load properties" | Run `supabase/schema.sql` (new project) |
| "Reviews are being set up" | Run `supabase/updates/update_4_reviews.sql` |
| "The marketplace is being set up" | Run `supabase/updates/update_5_marketplace.sql` |
| "Screenshot upload is being set up" | Run `supabase/updates/update_7_payment_proof.sql` |
| "Security check required" | Turn Captcha OFF (Attack Protection) |
| "email confirmation is switched on" | Turn Confirm email OFF |
| "The reset email could not be sent" | Set up SMTP (section A) |
| Google `redirect_uri_mismatch` | In Google Cloud, redirect URI must be `https://usamujceckeghagaller.supabase.co/auth/v1/callback` |
| Old version still showing | Press **Ctrl+F5** |
