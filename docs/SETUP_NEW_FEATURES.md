# RAQBO — setting up the new features

This update adds: browse-before-sign-in, faster loading, property pages with WhatsApp previews, install-as-app, a notification bell, chat, WhatsApp order updates, a map view, an Urdu/English switch, property tools (price per marla, instalment calculator, crore/lakh budgets) and the redesigned About page.

Do the steps in order. Steps 1–3 are needed for everything to work. Steps 4–7 can be done later.

---

## 1. Put the update online

```
cd C:\Users\bombaytraders\Projects\raqbo-repo
git add .
git commit -m "Live features: chat, bell, map, Urdu, property pages, PWA"
git push
```

Vercel deploys it automatically in about a minute. The new `api/` folder (property pages and sitemap) works on Vercel with no extra setup.

## 2. Update the database (Supabase)

Supabase → **SQL Editor** → New query → paste and **Run**:

1. `supabase/update_8_order_emails.sql` — only if you have not run it yet (order emails).
2. `supabase/update_9_live.sql` — notification bell, chat, WhatsApp numbers for order updates, and map pins.

Both are safe to run more than once. Until `update_9` is run, the site still works: the bell stays empty and chat shows "Messages are being set up".

## 3. Check it works

Open the website in a private window and check:

- [ ] The home page opens **without** asking you to sign in.
- [ ] Scroll the properties: 12 load at a time.
- [ ] Open a property → **Message the advertiser** → sign in → the chat opens.
- [ ] Sign in → the **bell** appears next to your name.
- [ ] Click **Map** above the property list.
- [ ] Click **اردو** in the top strip, then **English** to switch back.
- [ ] Share a property on WhatsApp → the preview shows the photo and price.
      (The link looks like `…/p/RQ-LST-XXXX`. WhatsApp caches previews, so test with a property you have not shared before.)

---

## 4. Domain and hosting (before the commercial launch)

Vercel's free **Hobby** plan is for **non-commercial use only**. RAQBO is a business, so choose one option:

- **Vercel Pro**: Vercel → Settings → Billing → Upgrade.
- or move hosting later (ask Claude). The property pages and sitemap use Vercel functions, so they would need converting.

**Connect raqbo.pk:**

1. Vercel → your project → **Settings → Domains** → add `raqbo.pk` and `www.raqbo.pk`.
2. At your domain registrar, add the DNS records that Vercel shows on that screen (usually an **A** record for `raqbo.pk` and a **CNAME** for `www`).
3. Supabase → **Authentication → URL Configuration**:
   - Site URL: `https://raqbo.pk`
   - Redirect URLs: add `https://raqbo.pk/**`
4. Supabase → SQL Editor → run:
   ```sql
   update public.raqbo_settings set value = 'https://raqbo.pk' where key = 'site_url';
   ```
   This makes the links in emails and WhatsApp messages point to the domain.

**Google:** in Google Search Console, add `raqbo.pk`, then submit both sitemaps:

- `https://raqbo.pk/sitemap.xml`
- `https://raqbo.pk/sitemap-properties.xml`

Each approved property then gets its own page that Google can list.

**Analytics:** Vercel → your project → **Analytics** → Enable. The site already includes the tracking script, so visitor numbers start appearing after that.

---

## 5. Send email from your own address (instead of Gmail)

Gmail is limited to about 500 emails a day, and Supabase's built-in email allows only **2 per hour**. A proper sender fixes both. Example with **Brevo** (free plan: 300 emails/day); **Resend** works the same way.

1. Create a Brevo account → **Senders & Domains** → add `raqbo.pk`.
2. Add the DNS records Brevo shows (SPF/DKIM) at your registrar → verify.
3. Brevo → **SMTP & API** → create an **SMTP key**.
4. **Supabase → Authentication → Emails → SMTP Settings** → enable custom SMTP:
   - Host: `smtp-relay.brevo.com`
   - Port: `587`
   - User: your Brevo login
   - Password: the SMTP key
   - Sender: `noreply@raqbo.pk`, name `RAQBO`

   This fixes password-reset and sign-up emails.
5. **n8n:** in both RAQBO workflows, replace the Gmail node with a **Send Email** node:
   - Use an SMTP credential with the same Brevo details.
   - From: `noreply@raqbo.pk`
   - To: `{{ $json.to }}` (admin alerts: `raqbo.official@gmail.com`)
   - Subject: `{{ $json.subject }}`
   - Email format: HTML, HTML: `{{ $json.html }}`

---

## 6. WhatsApp order updates (optional)

Buyers and vendors get a WhatsApp message at each order step, alongside the email. This uses Meta's official **WhatsApp Business Cloud API**. Meta charges a small fee per business-initiated conversation; check current Pakistan rates in Meta's pricing page.

1. Go to business.facebook.com → create or open the RAQBO business → **WhatsApp Manager**.
2. Add a phone number for the business. It cannot be one that is currently used in the normal WhatsApp app.
3. **Message templates → Create template**:
   - Category: **Utility**
   - Name: `raqbo_order_update`
   - Language: English
   - Body (4 variables):
     ```
     Assalam o Alaikum {{1}}, here is an update on your RAQBO order {{2}}: {{3}}. View your order: {{4}}
     ```
   Submit it and wait for approval (usually minutes to a day).
4. In Meta's developer app → **WhatsApp → API Setup**, copy the **Phone number ID**.
5. Create a **permanent access token**: Business Settings → **System users** → add one → generate a token with the `whatsapp_business_messaging` permission.
6. **n8n** → workflow **RAQBO order status emails** → node **Build WhatsApp message**:
   - Fill in `WA_PHONE_ID` and `WA_TOKEN`.
   - Set `SECRET` to the same value as the Supabase webhook secret.
   - Save.

Leave `WA_TOKEN` empty to keep WhatsApp switched off. Email keeps working either way.

---

## 7. Growing past the free plans

| Limit (free plans) | What happens | Fix |
|---|---|---|
| Supabase: 200 live connections at once | More than 200 people in chat, on property pages or in the marketplace at the same time stop getting live updates. Pages still work. | Supabase Pro ($25/month): 500 connections |
| Supabase: 5 GB downloads/month | Photos are now compressed to about 300 KB, so this lasts roughly 5,000 visitors. | Supabase Pro: 250 GB |
| Supabase: 1 GB file storage | Videos (up to 50 MB) fill it fastest. | Use YouTube links for videos, or Supabase Pro (100 GB) |
| Vercel Hobby | Not allowed for commercial use. | Vercel Pro |

---

## Good to know

- **Urdu:**
  - Covers the header, search, property cards, services, footer, sign-in, bell and messages.
  - Advertiser text (titles, descriptions, areas) and the About page stay exactly as written.
  - The marketplace and the admin panel stay in English.
  - To add or correct a translation, edit the `UR` list at the top of `i18n.js` (in the build files) and rebuild.
- **Map:**
  - Advertisers can drop an exact pin when listing a property (optional).
  - Properties without a pin are grouped by city on the map.
  - Maps are free OpenStreetMap maps; no Google Maps API key is needed.
- **Instalment calculator:** an estimate only; it says so on screen.
- **Chat safety:**
  - Messages are private to the two people in the chat (and the RAQBO team for support chats).
  - There is a limit of 20 messages a minute to stop spam.
