import { NextRequest } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { database } from "@/lib/server/database";
import { errorResponse, HttpError, json, logAudit, requireSameOrigin } from "@/lib/server/http";
import { publicListing, type ListingRow } from "@/lib/server/listings";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireUser();
    const listings = database.prepare(`
      SELECT listings.* FROM favorites
      JOIN listings ON listings.id = favorites.listing_id
      WHERE favorites.user_id = ? AND listings.status = 'live'
      ORDER BY favorites.created_at DESC
    `).all(user.id) as ListingRow[];
    return json({ listings: listings.map(publicListing) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    requireSameOrigin(request);
    const user = await requireUser();
    let value: unknown;
    try {
      value = await request.json();
    } catch {
      throw new HttpError(400, "invalid_json", "Request body must be valid JSON.");
    }
    const body = z.object({ listingId: z.string().uuid() }).parse(value);
    const listing = database
      .prepare("SELECT id FROM listings WHERE id = ? AND status = 'live' LIMIT 1")
      .get(body.listingId);
    if (!listing) throw new HttpError(404, "listing_not_found", "This property listing is not available.");
    database.prepare("INSERT OR IGNORE INTO favorites(user_id, listing_id) VALUES (?, ?)").run(user.id, body.listingId);
    logAudit(user.id, "favorite.added", "listing", body.listingId);
    return json({ listingId: body.listingId, saved: true }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    requireSameOrigin(request);
    const user = await requireUser();
    const listingId = request.nextUrl.searchParams.get("listing_id");
    const parsedId = z.string().uuid().safeParse(listingId);
    if (!parsedId.success) throw new HttpError(400, "invalid_listing_id", "A valid listing ID is required.");
    database.prepare("DELETE FROM favorites WHERE user_id = ? AND listing_id = ?").run(user.id, parsedId.data);
    logAudit(user.id, "favorite.removed", "listing", parsedId.data);
    return json({ listingId: parsedId.data, saved: false });
  } catch (error) {
    return errorResponse(error);
  }
}
