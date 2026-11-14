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
- Interactive `/deals` preview of a RAQBO-mediated transaction journey: sample property discovery, coordinator messages, viewing requests, offer/counter-offer actions, and a document-check status panel
- Saved-properties page, phone-verified account access, listing editing and availability controls, owner feedback, and account deletion requests
- RAQBO-mediated property requests with separate buyer/owner account updates and a staff coordination queue; buyer and owner messages are not exposed to each other
- Property-specific reports and moderation
- Illustrative, clearly labeled demo property cards across the listed categories; demo records are excluded from the public inventory API and use local artwork
- Local SQLite API foundation for listing search/drafts, OTP authentication, favorites, coordinated inquiries, reports, service requests, moderation, verification, account deletion requests and audit history
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

Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in `.env.local` from the Supabase project settings. Phone OTP uses Supabase Auth when both values are configured; enable Phone Auth and configure an SMS provider and message template in the Supabase dashboard. Supabase project URL and publishable/anon key are public client configuration, but never put a service-role/secret key in a `NEXT_PUBLIC_` variable, source control, or chat.

The OTP migration is the first Supabase stage. Verified Supabase auth IDs are linked to the existing local user profile, while application sessions, profiles, marketplace data, and media remain in local SQLite/disk for now. This deliberately does not import existing local data or replace the other backend routes. Review the current data and back it up before the later database and storage migrations. Configure `RAQBO_ALLOW_DEV_OTP=true` only for local development without Supabase; it must remain disabled in production.

Set `RAQBO_SEED_DEMO_DATA=true` only when intentionally testing the example records.

The first admin is created at `/admin` using the owner-controlled `RAQBO_ADMIN_BOOTSTRAP_KEY`; the key is not available from the public site. Initial setup is one-time and serialized. Staff authentication currently uses email/password; define the approved staff MFA policy before launch.

## Important limitations before production

The `/deals` page is a front-end interaction demo only. Its people, listings, messages, offers, and viewing requests are fictional and exist only in page memory; they are not saved, shared across devices, or sent to real property owners. Do not enter real personal, identity, title-document, or payment information. Live listing requests are stored separately and handled through the staff coordination queue.

This is a working local backend foundation, not a production-ready complete marketplace. Photos are re-encoded to remove image metadata; MP4 videos receive container/size checks but are not transcoded or metadata-scrubbed. There is no malware-scanning vendor. Private title-document storage, email/SMS delivery, automated inquiry notifications, full offer and viewing workflows, two-way buyer/seller chat, advertiser phone/WhatsApp disclosure, payment/escrow, e-signatures, saved-search alerts, map-based search, agency accounts, and analytics are not implemented. Staff can manually coordinate requests and send separate updates to buyer and owner; this is not a complete transaction or legal workflow. A listing can link to an external map search, but that is not a map integration. Listing submission requires at least one property photo; videos and 3D media are optional. Only approved media on live listings is public. Owner archiving is a soft archive, not hard deletion; no restore action is available yet. Deletion requests are queued for manual handling and need an approved retention policy and completion workflow.

SQLite and local disk storage are intended for development only. Production must use a supported durable database and private object storage, an explicit migration/backup plan, and malware scanning. Also select and configure an approved OTP provider, staff MFA, any licensed map/payment services, TLS/domain/hosting, monitoring, least-privilege staff access, client-approved Urdu translations, and legal/privacy/terms review. Dynamic SEO pages per listing and production analytics also remain to be designed. These integrations require RAQBO-approved vendors, account credentials, privacy terms, and operational policies; they cannot be enabled safely by choosing providers or inventing legal/translation content on RAQBO's behalf. The site does not provide escrow, title guarantees, or official government registry checks.

Do not put passwords, API keys, payment credentials, or sensitive identity/property documents in source control or chat.
