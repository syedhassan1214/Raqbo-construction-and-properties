# RAQBO — Properties · Land · Investment (raqbo.pk)

Complete website + backend setup for RAQBO, a Pakistan property platform.
**To put it online, follow `HOSTING_GUIDE.md`.**

## Editing the code (read this first)
The website's code lives in `src/`, split into small files. `index.html` and `assets/app.<hash>.css/js` are **generated**, so never edit them by hand: your change would be lost at the next build.

| Where | What |
|---|---|
| `src/index.html` | Page markup and the **RAQBO SETTINGS** block (Supabase URL/key, WhatsApp number). `<!-- @css -->` and `<!-- @js -->` mark where the styles and app are linked |
| `src/css/NN-name.css` | Styles, one file per section, loaded in number order |
| `src/js/NN-name.js` | The app, one file per feature, joined in number order (they share one scope, so keep the order) |
| `src/i18n/ur.js` | Urdu translations, loaded only when Urdu is selected |
| `src/features/official-auctions-admin.js` | Official-auction administration renderer, loaded when its admin tab is opened |
| `build.mjs` | Joins and minifies the shared app scope and builds a separate hashed Urdu module |

After any change:
```
npm install        (first time only)
npm run bundle     (or: npm run bundle:dev for unminified output, easier to debug)
npm test           (isolated PostgreSQL authorization and contact-guard tests)
git add -A && git commit -m "…" && git push
```
The file names change with the content, so visitors get the new version immediately while unchanged files stay cached for 30 days.
The main app still shares one scope and is not yet fully modular. Urdu and official-auction administration are fetched on demand; if a module cannot load, an error allows a retry. Previously selected Urdu is loaded on startup.

## Folder contents
| Folder / file | What it is |
|---|---|
| `website/` | **Upload the contents of this folder to your hosting.** This is the whole website. |
| `website/index.html` | Main website (home, search, property pages, reviews, sign-in, **Sell With Us & Order Online** marketplace, admin panel at `#admin`) |
| `website/about-us.html` | Standalone About us page (the same page also opens inside the main site) |
| `website/sell-with-us.html` | Short link that opens the marketplace (`index.html#marketplace`) |
| `website/privacy.html`, `terms.html` | Privacy Policy and Terms of Use |
| `website/content.js` | About us text (founder, projects) **and the escrow account buyers pay into** — edit this file |
| `website/images/` | Put `founder.jpg` and project photos here |
| `website/icons/` | Official social logos (already built into the website) |
| `website/robots.txt`, `sitemap.xml`, `.htaccess` | Search engines + cPanel/Apache settings |
| `supabase/schema.sql` | Full database setup for a **new, empty** Supabase project |
| `supabase/FRESH_INSTALL.sql` | Wipes RAQBO tables and installs everything again (**deletes all listings, reviews, enquiries**) |
| `supabase/updates/` | Updates for an existing project (already included in `schema.sql`) |
| `n8n/` | n8n workflows: admin alerts (new listings, requests, reports) and order status emails to buyers, vendors and admin |
| `docs/` | Client overview document (features and services) |

## Features
- **Two-row app bar**: Buy · Sell · Rent · RAQBO Direct · Services ▾ · About us, plus **"Welcome back, *Name*"** account button (My account, Saved, My material orders, My shop, Admin panel, Sign out)
- **Services ▾ dropdown**: Sell With Us & Order Online + Our Services (verification, legal, documents, registry) + *Explore all services*
- **Our Services**: eye-catching photo slideshow on the home page and a full Services page (`#our-services`)
- Home screen shows the social media links and the office address under *Browse properties*
- **Sell With Us & Order Online** (construction material marketplace):
  - Vendor & buyer directory: material chips, search (shop / area / material / product code), city, *Escrow-enabled only* and *Verified* filters, result counter
  - Vendor cards: logo initials, Verified + Escrow badges, shop & owner, area/city + delivery radius, material tags, "From PKR … / unit" with **live rates**, star rating, Buy Now / Request Quote, WhatsApp, Call
  - Vendor page: catalog with live prices (▲▼ change), stock, minimum order; cart with delivery charges and commercial-buyer discount
  - **Escrow orders**: buyer pays RAQBO (Bank, JazzCash, Easypaisa, SadaPay, NayaPay) and uploads a **payment screenshot** → admin checks the screenshot → vendor dispatches (vehicle, driver, ETA) → buyer confirms → admin releases payout; disputes with refund/release
  - Quotes for "price on request" items; buyer accepts and pays through escrow
  - Supplier profile (public shop details + private NTN/CNIC, warehouse, payout account), catalog & pricing dashboard, order management
  - Buyer profile (buyer type, saved delivery addresses), order history and tracking timeline
  - Only buyers with completed orders can review vendors
  - **Admin panel → Sell With Us**: escrow payments, disputes, suppliers (approve / Verified / Escrow / private details), buyers (commercial status), all material orders
  - Everything updates in real time (rates, orders, statuses)
- **Sign-in screen** on open: email + password, or Continue with Google; mobile number required
- **Forgot password** with an emailed reset link
- **Property search**: Buy / Rent / Sell, location, type, budget, direct owner, sort, favorites
- **Property comparison**: compare up to three published public listings; the selection is saved on the device when browser storage is available. Sale prices and monthly rents are not ranked against each other.
- **Property page**: 16:9 photo & video slideshow (auto-play, swipe, full screen), description, details, similar properties, WhatsApp contact through RAQBO, and in-app RAQBO support chat. The displayed property reference is prefilled in an editable chat draft; the user must send it.
- **Live reviews & star ratings** (real-time), ratings on property cards
- **Share a property**: copy link, WhatsApp, Facebook, Email, SMS — new visitors register and then land on that property
- **List a property** with photos and video; stays hidden until an admin approves it; owners can edit/delete their listings
- **Services** (verification, legal, documents, registry): a short form, then WhatsApp opens with the details filled in
- **Property Passport**: public published listings include a QR link to the current property page (sign-in may be required); the QR is not proof of title or verification. The document examples are not a record of documents received or checked; recorded checks appear in the verification history. Buyers can send an in-app verification enquiry from an unverified passport and track it in My RAQBO → Service requests; staff handle it under Service enquiries. Verification depends on the owner's cooperation and is not automatic. QR generation uses the existing integrity-checked CDN library; retry if it cannot load.
- **About us**: founder message, completed and ongoing project slideshows, upcoming projects
- **Admin panel** (`yourwebsite/#admin`): approve/reject listings, handle requests and reports, remove reviews
- Spam limits, report a property, privacy & terms pages, official WhatsApp/Instagram/Facebook/Pinterest/YouTube links

## Backend
Everything runs on **Supabase** (free plan): sign-in, Postgres database with row-level security, file storage for photos/videos, and real-time updates for reviews, live rates and orders.

**Property offers and chat:** Apply `supabase/update_35_listing_offers.sql` after the preceding updates on an existing Supabase project before deploying the rebuilt website. For new projects, the update is included at the end of `schema.sql` and `FRESH_INSTALL.sql`; apply updates 32–34 separately after `schema.sql` if needed. `FRESH_INSTALL.sql` deletes existing data and is for a fresh installation only. Published normal sale and rental listings accept offers; auctions use their separate bidding workflow. Sellers see received offers highest first, and participants can use the existing listing conversation for public offers. Investor-only opportunities remain coordinated by RAQBO. An accepted offer is conditional, not a completed sale or rental; payment and agreements are not automated by this feature.

**Listing moderation:** Apply `supabase/update_36_listing_moderation.sql` after all previous updates before deploying the rebuilt website. It is also appended to the installation scripts. The Possible duplicates section combines detail, title and cover-photo matches with open suspicious-activity and duplicate reports. The live dashboard loads up to 500 recent listings and 500 reports; the photo scan checks up to 400 listings. Matches are suggestions, not proof; staff must review them before deleting. Listing staff can edit the listed text, location, size and price, send an in-app note to an advertiser, or permanently delete a listing after confirmation. Deletion can cascade to related records. If media cleanup fails after a deletion, the dashboard reports the failure and storage must be cleaned up separately. The database enforces the `listings` permission for listing moderation and limits access to non-public listings and advertiser profiles. Review staff permissions before applying the migration: admins without that permission will no longer have those accesses.

**Chat scope:** Apply `supabase/update_37_chat_scope.sql` after updates 32 and 36. It rejects conversations with multiple unrelated topics and restricts block-status checks to the conversation's participants and admins (who already have access to all chats). It is included in `FRESH_INSTALL.sql`; for `schema.sql` installations, apply updates 32–34 and then 37 separately. The browser contact guard is advisory only: it can be bypassed and its local logs are not centrally available to administrators. It is not a database security boundary or a guarantee against off-platform contact.

**Contact filter:** Apply `supabase/update_38_chat_contact_guard.sql` after update 37, and `supabase/update_40_public_contact_guard.sql` after update 39. The database rejects common phone, CNIC, email, link and social-contact patterns in member-to-member chat and newly written listing titles/descriptions, reviews and wanted-post details, including Arabic and Persian numerals. Staff messages and RAQBO support chats are exempt at the database so members can provide information to RAQBO; the existing browser-side checks still apply to non-admin users, including support chats. The filter can miss obfuscations, reject legitimate text, and does not cover every field or attachment. Existing unchanged text is not rechecked when editing other fields. Rejected content is not saved or centrally logged. Both updates are included in `FRESH_INSTALL.sql`; apply them separately in order for `schema.sql` installations.

**Sensitive-data permissions:** Apply `supabase/update_39_sensitive_data_scope.sql` after update 38. Rental management requires `services`, screening and identity documents require `verification`, commercial administration requires `listings`, and tax administration requires `settings`. Legal administration is limited to full admins; clients and assigned lawyers retain access to their own appointments. Lawyer licence/CNIC documents and internal notes are no longer selectable from the public lawyer directory; the private profile RPC remains available to the lawyer. Review existing staff permissions before deployment. The update is included in `FRESH_INSTALL.sql`; apply it separately after updates 32–34 and 37–38 for `schema.sql` installations.

**About escrow payments:** money is paid into RAQBO's own account (details in `content.js`) and the admin confirms each payment and payout in the marketplace Admin tab. This works today without any payment gateway. Automatic card/wallet payments need a merchant account (JazzCash, Easypaisa or a bank gateway) and can be connected later. The website talks to Supabase directly — there is no separate server. Your project URL and public (anon) key are already inside `website/index.html`.
Never put the Supabase **service_role** key in the website.

## Contact details used on the website
WhatsApp / UAN 0300 1223344 (wa.me/923001223344) · raqbo.official@gmail.com · raqbo.pk
