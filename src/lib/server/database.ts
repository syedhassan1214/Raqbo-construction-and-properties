import "server-only";

import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const configuredDatabasePath = process.env.RAQBO_DATABASE_PATH;

if (process.env.NODE_ENV === "production" && !configuredDatabasePath) {
  throw new Error("RAQBO_DATABASE_PATH must point to persistent storage in production.");
}

if (configuredDatabasePath && !isAbsolute(configuredDatabasePath)) {
  throw new Error("RAQBO_DATABASE_PATH must be an absolute path.");
}
const databasePath = resolve(configuredDatabasePath ?? ".data/raqbo.sqlite");

mkdirSync(dirname(databasePath), { recursive: true });

const database = new DatabaseSync(databasePath, {
  enableForeignKeyConstraints: true,
  timeout: 5000,
});

database.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    role TEXT NOT NULL CHECK (role IN ('buyer', 'owner', 'admin', 'moderator', 'verifier', 'support', 'finance')),
    email TEXT UNIQUE,
    password_hash TEXT,
    phone_hash TEXT UNIQUE,
    supabase_auth_id TEXT,
    phone_encrypted TEXT,
    display_name TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'deletion_requested', 'deleted')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    revoked_at TEXT
  );

  CREATE INDEX IF NOT EXISTS sessions_active_lookup
    ON sessions(token_hash, expires_at) WHERE revoked_at IS NULL;

  CREATE TABLE IF NOT EXISTS otp_challenges (
    id TEXT PRIMARY KEY,
    phone_hash TEXT NOT NULL,
    code_hash TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    consumed_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS otp_lookup ON otp_challenges(phone_hash, created_at);

  CREATE TABLE IF NOT EXISTS rate_limits (
    rate_key TEXT PRIMARY KEY,
    window_started_at INTEGER NOT NULL,
    request_count INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS listings (
    id TEXT PRIMARY KEY,
    creator_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    deal_type TEXT NOT NULL CHECK (deal_type IN ('buy', 'rent')),
    category TEXT NOT NULL,
    subtype TEXT,
    ownership_type TEXT NOT NULL CHECK (ownership_type IN ('owner', 'co_owner', 'authorized_representative', 'agent', 'developer')),
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    province TEXT NOT NULL DEFAULT 'Punjab',
    city TEXT NOT NULL,
    locality TEXT NOT NULL,
    size_value REAL NOT NULL,
    size_unit TEXT NOT NULL,
    price_pkr INTEGER NOT NULL,
    negotiable INTEGER NOT NULL DEFAULT 0 CHECK (negotiable IN (0, 1)),
    bedrooms INTEGER,
    bathrooms INTEGER,
    attributes_json TEXT NOT NULL DEFAULT '{}',
    cover_image TEXT,
    approximate_lat REAL,
    approximate_lng REAL,
    status TEXT NOT NULL DEFAULT 'draft'
      CHECK (status IN ('draft', 'submitted', 'needs_changes', 'rejected', 'live', 'paused', 'under_offer', 'sold', 'rented', 'expired', 'archived')),
    verification_status TEXT NOT NULL DEFAULT 'not_verified'
      CHECK (verification_status IN ('not_verified', 'phone_confirmed', 'identity_checked', 'authority_checked', 'documents_reviewed', 'approval_document_reviewed', 'legal_opinion_issued')),
    is_demo INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0, 1)),
    confirmed_at TEXT,
    expires_at TEXT,
    reviewed_at TEXT,
    reviewed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    review_note TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS public_listing_search
    ON listings(status, deal_type, city, category, price_pkr, created_at DESC);
  CREATE INDEX IF NOT EXISTS owner_listing_lookup
    ON listings(creator_id, status, updated_at DESC);

  CREATE TABLE IF NOT EXISTS verification_cases (
    id TEXT PRIMARY KEY,
    listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    check_type TEXT NOT NULL CHECK (check_type IN ('identity', 'authority', 'title_documents', 'project_approval', 'legal_opinion', 'physical_inspection')),
    status TEXT NOT NULL DEFAULT 'requested'
      CHECK (status IN ('requested', 'in_review', 'pending_second_review', 'confirmed', 'unconfirmed', 'issue_identified', 'not_checked', 'revoked')),
    scope TEXT NOT NULL,
    evidence_summary TEXT NOT NULL DEFAULT '',
    reviewer_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    second_reviewer_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    expires_at TEXT,
    reviewed_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS verification_queue ON verification_cases(status, created_at DESC);
  CREATE INDEX IF NOT EXISTS listing_verification_history ON verification_cases(listing_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS media_assets (
    id TEXT PRIMARY KEY,
    listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    storage_key TEXT NOT NULL UNIQUE,
    mime_type TEXT NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
    file_size INTEGER NOT NULL,
    scan_status TEXT NOT NULL DEFAULT 'pending' CHECK (scan_status IN ('pending', 'clean', 'rejected')),
    exif_scrubbed INTEGER NOT NULL DEFAULT 0 CHECK (exif_scrubbed IN (0, 1)),
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS property_3d_assets (
    id TEXT PRIMARY KEY,
    listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    asset_type TEXT NOT NULL CHECK (asset_type IN ('property_photo', 'property_video', 'model_glb', 'panorama')),
    storage_key TEXT NOT NULL UNIQUE,
    mime_type TEXT NOT NULL CHECK (mime_type IN ('model/gltf-binary', 'image/jpeg', 'image/webp', 'video/mp4')),
    file_size INTEGER NOT NULL,
    review_status TEXT NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending', 'approved', 'rejected')),
    reviewer_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at TEXT,
    review_note TEXT,
    ai_status TEXT NOT NULL DEFAULT 'disabled' CHECK (ai_status IN ('disabled', 'queued', 'complete', 'failed')),
    ai_result_json TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS property_3d_review_queue
    ON property_3d_assets(review_status, created_at DESC);
  CREATE INDEX IF NOT EXISTS property_3d_listing
    ON property_3d_assets(listing_id, review_status, created_at);

  CREATE TABLE IF NOT EXISTS inquiries (
    id TEXT PRIMARY KEY,
    listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'read', 'replied', 'closed', 'flagged')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS inquiries_owner_lookup ON inquiries(sender_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS favorites (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, listing_id)
  );

  CREATE TABLE IF NOT EXISTS reports (
    id TEXT PRIMARY KEY,
    listing_id TEXT REFERENCES listings(id) ON DELETE SET NULL,
    reporter_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    category TEXT NOT NULL,
    message TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'investigating', 'resolved', 'dismissed')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS service_requests (
    id TEXT PRIMARY KEY,
    requester_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    phone_encrypted TEXT NOT NULL,
    city TEXT NOT NULL,
    service_type TEXT NOT NULL,
    message TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'submitted'
      CHECK (status IN ('submitted', 'under_review', 'information_required', 'quoted', 'in_progress', 'completed', 'closed')),
    assigned_to TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS service_queue ON service_requests(status, created_at DESC);

  CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT,
    details_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS audit_timeline ON audit_logs(created_at DESC);

  CREATE TABLE IF NOT EXISTS deletion_requests (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'in_progress', 'completed', 'rejected')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

const inquiryColumns = database.prepare("PRAGMA table_info(inquiries)").all() as { name: string }[];
if (!inquiryColumns.some((column) => column.name === "buyer_update")) {
  database.exec("ALTER TABLE inquiries ADD COLUMN buyer_update TEXT");
}
if (!inquiryColumns.some((column) => column.name === "owner_update")) {
  database.exec("ALTER TABLE inquiries ADD COLUMN owner_update TEXT");
}
if (!inquiryColumns.some((column) => column.name === "assigned_to")) {
  database.exec("ALTER TABLE inquiries ADD COLUMN assigned_to TEXT REFERENCES users(id) ON DELETE SET NULL");
}
database.exec(`
  CREATE INDEX IF NOT EXISTS inquiries_coordination_queue
    ON inquiries(status, created_at DESC);
`);

const userColumns = database.prepare("PRAGMA table_info(users)").all() as { name: string }[];
if (!userColumns.some((column) => column.name === "supabase_auth_id")) {
  database.exec("ALTER TABLE users ADD COLUMN supabase_auth_id TEXT");
}
database.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS users_supabase_auth_id
    ON users(supabase_auth_id) WHERE supabase_auth_id IS NOT NULL;
`);

const propertyMediaSchema = database
  .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'property_3d_assets'")
  .get() as { sql: string } | undefined;
if (propertyMediaSchema && !propertyMediaSchema.sql.includes("'property_video'")) {
  database.exec(`
    BEGIN IMMEDIATE;
    CREATE TABLE property_3d_assets_v2 (
      id TEXT PRIMARY KEY,
      listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      asset_type TEXT NOT NULL CHECK (asset_type IN ('property_photo', 'property_video', 'model_glb', 'panorama')),
      storage_key TEXT NOT NULL UNIQUE,
      mime_type TEXT NOT NULL CHECK (mime_type IN ('model/gltf-binary', 'image/jpeg', 'image/webp', 'video/mp4')),
      file_size INTEGER NOT NULL,
      review_status TEXT NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending', 'approved', 'rejected')),
      reviewer_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      reviewed_at TEXT,
      review_note TEXT,
      ai_status TEXT NOT NULL DEFAULT 'disabled' CHECK (ai_status IN ('disabled', 'queued', 'complete', 'failed')),
      ai_result_json TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO property_3d_assets_v2 (
      id, listing_id, owner_id, asset_type, storage_key, mime_type, file_size,
      review_status, reviewer_id, reviewed_at, review_note, ai_status, ai_result_json, created_at
    )
    SELECT
      id, listing_id, owner_id, asset_type, storage_key, mime_type, file_size,
      review_status, reviewer_id, reviewed_at, review_note, ai_status, ai_result_json, created_at
    FROM property_3d_assets;
    DROP TABLE property_3d_assets;
    ALTER TABLE property_3d_assets_v2 RENAME TO property_3d_assets;
    CREATE INDEX property_3d_review_queue ON property_3d_assets(review_status, created_at DESC);
    CREATE INDEX property_3d_listing ON property_3d_assets(listing_id, review_status, created_at);
    COMMIT;
  `);
}

const demoListings = [
  {
    id: "demo-home-lahore-dha",
    dealType: "buy",
    category: "House",
    title: "Contemporary family home",
    city: "Lahore",
    locality: "DHA Phase 6",
    size: 1,
    unit: "Kanal",
    price: 78_500_000,
    beds: 5,
    baths: 6,
    image: "photo-1600596542815-ffad4c1539a9",
    ownership: "owner",
    verification: "phone_confirmed",
  },
  {
    id: "demo-apartment-lahore-gulberg",
    dealType: "buy",
    category: "Apartment",
    title: "Sunlit apartment with a view",
    city: "Lahore",
    locality: "Gulberg",
    size: 1650,
    unit: "sq ft",
    price: 32_500_000,
    beds: 3,
    baths: 3,
    image: "photo-1600607687939-ce8a6c25118c",
    ownership: "owner",
    verification: "authority_checked",
  },
  {
    id: "demo-home-islamabad-bahria",
    dealType: "buy",
    category: "House",
    title: "A calm corner to call home",
    city: "Islamabad",
    locality: "Bahria Enclave",
    size: 10,
    unit: "Marla",
    price: 42_500_000,
    beds: 4,
    baths: 4,
    image: "photo-1600047509807-ba8f99d2cdde",
    ownership: "authorized_representative",
    verification: "not_verified",
  },
  {
    id: "demo-rental-home-lahore",
    dealType: "rent",
    category: "House",
    title: "Modern home, ready for move-in",
    city: "Lahore",
    locality: "Johar Town",
    size: 10,
    unit: "Marla",
    price: 165_000,
    beds: 4,
    baths: 4,
    image: "photo-1600566753086-00f18fb6b3ea",
    ownership: "owner",
    verification: "phone_confirmed",
  },
  {
    id: "demo-villa-karachi-dha",
    dealType: "buy",
    category: "House",
    title: "Open-plan villa with garden",
    city: "Karachi",
    locality: "DHA Phase 8",
    size: 500,
    unit: "sq yd",
    price: 112_000_000,
    beds: 5,
    baths: 6,
    image: "photo-1600585154340-be6161a56a0c",
    ownership: "authorized_representative",
    verification: "documents_reviewed",
  },
  {
    id: "demo-rental-flat-islamabad",
    dealType: "rent",
    category: "Apartment",
    title: "A brighter kind of city living",
    city: "Islamabad",
    locality: "F-11",
    size: 1250,
    unit: "sq ft",
    price: 115_000,
    beds: 2,
    baths: 2,
    image: "photo-1600607687920-4e2a09cf159d",
    ownership: "owner",
    verification: "authority_checked",
  },
];

if (process.env.NODE_ENV !== "production" || process.env.RAQBO_SEED_DEMO_DATA === "true") {
  const insertDemo = database.prepare(`
    INSERT OR IGNORE INTO listings (
      id, deal_type, category, ownership_type, title, description, city, locality,
      size_value, size_unit, price_pkr, bedrooms, bathrooms, cover_image, status,
      verification_status, is_demo, confirmed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'live', ?, 1, CURRENT_TIMESTAMP)
  `);
  for (const listing of demoListings) {
    insertDemo.run(
      listing.id,
      listing.dealType,
      listing.category,
      listing.ownership,
      listing.title,
      "Illustrative design-preview content only. Not a real property advertisement.",
      listing.city,
      listing.locality,
      listing.size,
      listing.unit,
      listing.price,
      listing.beds,
      listing.baths,
      listing.image,
      listing.verification,
    );
  }
}

export { database, randomUUID };
