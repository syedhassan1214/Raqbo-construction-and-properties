# RAQBO — Properties · Land · Investment (raqbo.pk)

Complete website + backend setup for RAQBO, a Pakistan property platform.
**To put it online, follow `HOSTING_GUIDE.md`.**

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
- **Property page**: 16:9 photo & video slideshow (auto-play, swipe, full screen), description, details, similar properties
- **Live reviews & star ratings** (real-time), ratings on property cards
- **Share a property**: copy link, WhatsApp, Facebook, Email, SMS — new visitors register and then land on that property
- **List a property** with photos and video; stays hidden until an admin approves it; owners can edit/delete their listings
- **Services** (verification, legal, documents, registry): a short form, then WhatsApp opens with the details filled in
- **About us**: founder message, completed and ongoing project slideshows, upcoming projects
- **Admin panel** (`yourwebsite/#admin`): approve/reject listings, handle requests and reports, remove reviews
- Spam limits, report a property, privacy & terms pages, official WhatsApp/Instagram/Facebook/Pinterest/YouTube links

## Backend
Everything runs on **Supabase** (free plan): sign-in, Postgres database with row-level security, file storage for photos/videos, and real-time updates for reviews, live rates and orders.

**About escrow payments:** money is paid into RAQBO's own account (details in `content.js`) and the admin confirms each payment and payout in the marketplace Admin tab. This works today without any payment gateway. Automatic card/wallet payments need a merchant account (JazzCash, Easypaisa or a bank gateway) and can be connected later. The website talks to Supabase directly — there is no separate server. Your project URL and public (anon) key are already inside `website/index.html`.
Never put the Supabase **service_role** key in the website.

## Contact details used on the website
WhatsApp 0312 3140622 · UAN / WhatsApp 0300 1223344 · raqbo.official@gmail.com · raqbo.pk
