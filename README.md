# RAQBO — Properties · Land · Investment

Website for **RAQBO** (raqbo.pk), a Pakistan property platform: buy, rent and list homes, apartments, plots and commercial property, with verification, legal, documentation and registry services.

## What's inside
| Path | Purpose |
|---|---|
| `index.html` | The complete website (single file: design, logic, admin panel) |
| `supabase/schema.sql` | Database tables, security rules, storage bucket, sample listings |
| `supabase/reset_old_setup.sql` | One-time cleanup if an older RAQBO schema was installed |
| `supabase/update_2_edit_spam.sql` | Update for existing projects: edit/delete listings, spam limits |
| `privacy.html`, `terms.html` | Privacy Policy and Terms of Use |
| `n8n/RAQBO_admin_alerts.n8n.json` | n8n workflow: email alerts for new listings, requests and reports |
| `docs/` | Client overview document |
| `UPDATE_STEPS.md` | Steps for the latest update |
| `icons/` | Put official Google / WhatsApp / Instagram / Facebook / Pinterest / YouTube icon files here |
| `SETUP.md` | Step-by-step setup (Supabase, email codes, Google sign-in, admin) |

## Features
- Sign-in screen on open: create an account (name, email, mobile) with a **6-digit email code**, or **Continue with Google** and then confirm with an email code
- Property search: location, sale/rent, type, budget, direct-owner filter, sorting, categories, favorites
- Property details with photo gallery and MP4 walkthrough video
- List a property with photos and video; listings stay **pending until an admin approves**
- Advertisers can **edit** (back to review) and **delete** their own listings
- Spam protection: Cloudflare Turnstile on sign-in, per-account limits, verified-users-only requests
- Admin email alerts through n8n + Supabase database webhooks
- Privacy Policy and Terms of Use pages
- Service requests (verification, legal, documents, registry, general) open **WhatsApp** with the form details filled in
- Report a property; contact the advertiser through RAQBO on WhatsApp
- Admin panel (`#admin`): review, approve, reject listings; handle enquiries and reports
- Black & gold design matching the RAQBO logo; responsive on phones

## Tech
- Plain HTML/CSS/JavaScript, with no build step
- [Supabase](https://supabase.com) for the database, file storage, email-OTP and Google sign-in, and row-level security
- If Supabase can't be reached, the site falls back to a browser-only demo mode

## Run locally
```
npx serve -l 5500
```
Open http://localhost:5500 . See **SETUP.md** before first use.

## Contact
WhatsApp: +92 312 3140622 · UAN: 0300 1223344 · raqbo.official@gmail.com · raqbo.pk
