# RAQBO Website

Responsive Next.js website for the RAQBO Pakistan property marketplace. The mobile apps are intentionally out of scope for this website-first phase.

## Run locally

```powershell
npm install
npm run dev
```

Open the local URL printed by Next.js.

Create a production build with:

```powershell
npm run build
npm run start
```

The build script uses Webpack for compatibility with the current Windows environment.

## Included

- Responsive RAQBO public homepage, navigation, property categories, services, trust information, FAQs, and footer
- Server-filtered property search for sale/rent, location, property type, budgets, bedrooms, area, owner-only listings and sorting, with pagination
- Clear listing and verification states, verification scope/history, listing date and price-per-unit details; map links and shareable listing URLs
- Saved-properties page, phone-verified account access, listing editing and availability controls, owner feedback, and account deletion requests
- Listing inquiry inbox for buyers and advertisers, plus property-specific reports
- Illustrative, clearly labeled demo property cards across the listed categories; demo records are excluded from the public inventory API and use local artwork
- Local SQLite API foundation for listing search/drafts, OTP authentication, favorites, inquiries, reports, service requests, moderation, verification, account deletion requests and audit history
- Development-only OTP flow when explicitly enabled; no SMS provider is configured
- Protected `/admin` console for staff sign-in, first-admin bootstrap, review queues, user status, and audit history
- Admin listing status/search filters, rejected-listing restore, unpublish/archive controls, report-linked takedown action, and expanded overview counters
- Modern immersive-tour feature with interactive `.glb` models and 360° panoramas, plus MP4 property videos
- Private property-photo, MP4 video, 3D-model, and panorama uploads; photos are resized and metadata-stripped, while models and videos receive container validation
- Listing review shows complete property details and all attached media. One listing approval publishes the listing and approves all pending attached media together.
- AI workflow is deliberately disabled until RAQBO approves a provider, budget, terms, and explicit media-processing consent
- Service requests are validated, rate-limited, and stored with encrypted phone numbers
- Listing draft, media upload, OTP and service request forms submit to the local API
- Responsive mobile navigation and accessibility labels
- Draft privacy and terms pages explicitly marked for RAQBO/legal approval

## Local backend setup

Use Node.js 22.13 or newer (the project uses Node's built-in `node:sqlite`). Copy `.env.example` to `.env.local`, generate and set your own random secrets, and use an absolute path for `RAQBO_DATABASE_PATH`. Keep `.env.local` private and out of source control.

Supabase client helpers are available for the integration: set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in `.env.local` from the Supabase project settings. The current API still uses local SQLite, local OTP challenges, and local-disk media; adding the clients does not migrate or replace those systems yet. Never put a Supabase service-role/secret key in a `NEXT_PUBLIC_` variable, source control, or chat. We will migrate authentication, relational data, and storage in separate steps with reviewed schema and access policies.

To test OTP locally, set `RAQBO_ALLOW_DEV_OTP=true` only in a local development environment. The test code is returned to the local browser; do not enable this in production. Set `RAQBO_SEED_DEMO_DATA=true` only when intentionally testing the example records.

The first admin is created at `/admin` using the owner-controlled `RAQBO_ADMIN_BOOTSTRAP_KEY`; the key is not available from the public site. Initial setup is one-time and serialized. Staff authentication currently uses email/password; define the approved staff MFA policy before launch.

## Important limitations before production

This is a working local backend foundation, not a production-ready complete marketplace. Photos are re-encoded to remove image metadata; MP4 videos receive container/size checks but are not transcoded or metadata-scrubbed. There is no malware-scanning vendor. Private title-document storage, email/SMS delivery, inquiry notifications, two-way chat, advertiser phone/WhatsApp disclosure, payment/checkout, saved-search alerts, map-based search, agency accounts, and analytics are not implemented. A listing can link to an external map search, but that is not a map integration. Listing submission requires at least one property photo; videos and 3D media are optional. Only approved media on live listings is public. Owner archiving is a soft archive, not hard deletion; no restore action is available yet. Deletion requests are queued for manual handling and need an approved retention policy and completion workflow.

SQLite and local disk storage are intended for development only. Production must use a supported durable database and private object storage, an explicit migration/backup plan, and malware scanning. Also select and configure an approved OTP provider, staff MFA, any licensed map/payment services, TLS/domain/hosting, monitoring, least-privilege staff access, client-approved Urdu translations, and legal/privacy/terms review. Dynamic SEO pages per listing and production analytics also remain to be designed. These integrations require RAQBO-approved vendors, account credentials, privacy terms, and operational policies; they cannot be enabled safely by choosing providers or inventing legal/translation content on RAQBO's behalf. The site does not provide escrow, title guarantees, or official government registry checks.

Do not put passwords, API keys, payment credentials, or sensitive identity/property documents in source control or chat.
