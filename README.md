# RAQBO — Properties · Land · Investment

Website for **RAQBO** (raqbo.pk), a Pakistan property platform: buy, rent and list homes, apartments, plots and commercial property, with verification, legal, documentation and registry services.

## What's inside
| Path | Purpose |
|---|---|
| `index.html` | The complete website (single file: design, logic, admin panel) |
| `supabase/schema.sql` | Database tables, security rules, storage bucket, sample listings |
| `supabase/firebase_auth_migration.sql` | One-time migration to Firebase UID strings; preserves existing rows |
| `firebase/functions/` | Firebase-to-Supabase token bridge |
| `supabase/reset_old_setup.sql` | One-time cleanup if an older RAQBO schema was installed |
| `supabase/update_2_edit_spam.sql` | Legacy Supabase Auth update; do not use after Firebase migration |
| `privacy.html`, `terms.html` | Privacy Policy and Terms of Use |
| `n8n/RAQBO_admin_alerts.n8n.json` | n8n workflow: email alerts for new listings, requests and reports |
| `docs/` | Client overview document |
| `UPDATE_STEPS.md` | Steps for the latest update |
| `icons/` | Official-style Google / WhatsApp / Instagram / Facebook / Pinterest / YouTube brand SVGs used by the site |
| `SETUP.md` | Firebase Auth and Supabase data/storage setup |

## Features
- Firebase Authentication: Google sign-in or email/password with Firebase email verification
- Property search: location, sale/rent, type, budget, direct-owner filter, sorting, categories, favorites
- Property details with photo gallery and MP4 walkthrough video
- List a property with photos and video; listings stay **pending until an admin approves**
- Advertisers can **edit** (back to review) and **delete** their own listings
- Supabase row-level security for Firebase-authenticated marketplace data
- Admin email alerts through n8n + Supabase database webhooks
- Privacy Policy and Terms of Use pages
- Service requests (verification, legal, documents, registry, general) open **WhatsApp** with the form details filled in
- Report a property; contact the advertiser through RAQBO on WhatsApp
- Admin panel (`#admin`): review, approve, reject listings; handle enquiries and reports
- Black & gold design matching the RAQBO logo; responsive on phones

## Tech
- Plain HTML/CSS/JavaScript, with no build step
- [Firebase Authentication](https://firebase.google.com/docs/auth) for sign-in; [Supabase](https://supabase.com) for database, file storage, and row-level security
- If Supabase can't be reached, the site falls back to a browser-only demo mode

## Run locally
```
npx serve -l 5500
```
Open http://localhost:5500 . See **SETUP.md** before first use.

## Contact
WhatsApp: +92 312 3140622 · UAN: 0300 1223344 · raqbo.official@gmail.com · raqbo.pk
