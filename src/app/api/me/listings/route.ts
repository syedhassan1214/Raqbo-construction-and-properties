import { requireUser } from "@/lib/server/auth";
import { database } from "@/lib/server/database";
import { errorResponse, json } from "@/lib/server/http";
import { publicListing, type ListingRow } from "@/lib/server/listings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireUser(["owner"]);
    const listings = database
      .prepare("SELECT * FROM listings WHERE creator_id = ? ORDER BY updated_at DESC")
      .all(user.id) as ListingRow[];
    return json({
      listings: listings.map((listing) => ({
        ...publicListing(listing),
        reviewNote: listing.review_note,
      })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
