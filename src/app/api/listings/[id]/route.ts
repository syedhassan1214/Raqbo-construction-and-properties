import { NextRequest } from "next/server";
import type { SQLInputValue } from "node:sqlite";
import { requireUser } from "@/lib/server/auth";
import { database, randomUUID } from "@/lib/server/database";
import {
  errorResponse,
  HttpError,
  json,
  readJson,
  requireSameOrigin,
} from "@/lib/server/http";
import { listingSchema } from "@/lib/server/schemas";
import { publicListing, type ListingRow } from "@/lib/server/listings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type ListingContext = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, context: ListingContext) {
  try {
    const { id } = await context.params;
    const listing = database
      .prepare("SELECT * FROM listings WHERE id = ? AND status = 'live' AND is_demo = 0 LIMIT 1")
      .get(id) as ListingRow | undefined;
    if (!listing) throw new HttpError(404, "listing_not_found", "This property listing was not found.");
    const verification = database.prepare(`
      SELECT verification_cases.check_type, verification_cases.status, verification_cases.scope,
        verification_cases.reviewed_at, verification_cases.expires_at,
        users.display_name AS reviewer_name
      FROM verification_cases
      LEFT JOIN users ON users.id = verification_cases.reviewer_id
      WHERE listing_id = ? AND status IN ('confirmed', 'unconfirmed', 'issue_identified', 'not_checked')
      ORDER BY created_at DESC LIMIT 20
    `).all(id) as {
      check_type: string;
      status: string;
      scope: string;
      reviewed_at: string | null;
      expires_at: string | null;
      reviewer_name: string | null;
    }[];
    const media = database.prepare(`
      SELECT id, asset_type AS assetType
      FROM property_3d_assets
      WHERE listing_id = ? AND review_status = 'approved'
      ORDER BY created_at ASC
    `).all(id) as { id: string; assetType: string }[];
    return json({
      listing: {
        ...publicListing(listing),
        media: media.map((item) => ({
          ...item,
          url: `/api/3d-assets/${item.id}/file`,
        })),
        passport: verification.map((item) => ({
          checkType: item.check_type,
          status: item.status,
          scope: item.scope,
          checkedAt: item.reviewed_at,
          expiresAt: item.expires_at,
          checkedBy: item.reviewer_name || "RAQBO verification team",
        })),
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

const patchSchema = listingSchema.partial();

export async function PATCH(request: NextRequest, context: ListingContext) {
  try {
    requireSameOrigin(request);
    const user = await requireUser(["owner"]);
    const { id } = await context.params;
    const body = await readJson(request, patchSchema);
    const existing = database
      .prepare("SELECT id, creator_id, status FROM listings WHERE id = ? LIMIT 1")
      .get(id) as { id: string; creator_id: string | null; status: string } | undefined;
    if (!existing || existing.creator_id !== user.id) {
      throw new HttpError(404, "listing_not_found", "This property listing was not found.");
    }
    if (existing.status === "sold" || existing.status === "rented" || existing.status === "archived") {
      throw new HttpError(409, "listing_closed", "This listing can no longer be edited.");
    }
    const fields: Record<string, string> = {
      dealType: "deal_type",
      category: "category",
      subtype: "subtype",
      ownershipType: "ownership_type",
      title: "title",
      description: "description",
      province: "province",
      city: "city",
      locality: "locality",
      sizeValue: "size_value",
      sizeUnit: "size_unit",
      pricePkr: "price_pkr",
      bedrooms: "bedrooms",
      bathrooms: "bathrooms",
    };
    const updates: string[] = [];
    const values: SQLInputValue[] = [];
    for (const [field, column] of Object.entries(fields)) {
      if (body[field as keyof typeof body] !== undefined) {
        updates.push(`${column} = ?`);
        values.push(body[field as keyof typeof body] as SQLInputValue);
      }
    }
    if (body.negotiable !== undefined) {
      updates.push("negotiable = ?");
      values.push(body.negotiable ? 1 : 0);
    }
    if (body.attributes !== undefined) {
      updates.push("attributes_json = ?");
      values.push(JSON.stringify(body.attributes));
    }
    if (updates.length === 0) throw new HttpError(400, "no_changes", "Provide at least one listing change.");

    const materialChangeFields = new Set([
      "dealType", "category", "subtype", "ownershipType", "title", "description",
      "province", "city", "locality", "sizeValue", "sizeUnit", "pricePkr", "attributes",
    ]);
    const requiresReview = Object.keys(body).some((field) => materialChangeFields.has(field));
    updates.push("status = ?", "updated_at = CURRENT_TIMESTAMP");
    values.push(requiresReview && ["live", "rejected", "needs_changes"].includes(existing.status)
      ? "submitted"
      : existing.status);
    values.push(id, user.id);
    database.prepare(`
      UPDATE listings SET ${updates.join(", ")}
      WHERE id = ? AND creator_id = ?
    `).run(...values);
    database.prepare(`
      INSERT INTO audit_logs(id, actor_id, action, entity_type, entity_id, details_json)
      VALUES (?, ?, 'listing.updated', 'listing', ?, ?)
    `).run(randomUUID(), user.id, id, JSON.stringify({ requiresReview }));
    return json({
      id,
      status: requiresReview && ["live", "rejected", "needs_changes"].includes(existing.status)
        ? "submitted"
        : existing.status,
      requiresReview,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
