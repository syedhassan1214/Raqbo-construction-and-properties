import { NextRequest } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { database } from "@/lib/server/database";
import { errorResponse, HttpError, json, logAudit, readJson, requireSameOrigin } from "@/lib/server/http";
import { listingStatusSchema } from "@/lib/server/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type ListingContext = { params: Promise<{ id: string }> };

const transitions: Record<string, string[]> = {
  live: ["paused", "under_offer", "sold", "rented", "archived"],
  paused: ["live", "sold", "rented", "archived"],
  under_offer: ["live", "sold", "rented", "archived"],
  draft: ["archived"],
  submitted: ["archived"],
  needs_changes: ["archived"],
  rejected: ["archived"],
};

export async function PATCH(request: NextRequest, context: ListingContext) {
  try {
    requireSameOrigin(request);
    const user = await requireUser(["owner"]);
    const { id } = await context.params;
    const { status } = await readJson(request, listingStatusSchema);
    const listing = database
      .prepare("SELECT status, deal_type FROM listings WHERE id = ? AND creator_id = ? AND is_demo = 0")
      .get(id, user.id) as { status: string; deal_type: string } | undefined;
    if (!listing) throw new HttpError(404, "listing_not_found", "This listing was not found.");
    if (!transitions[listing.status]?.includes(status)) {
      throw new HttpError(409, "invalid_listing_transition", "This listing cannot be changed to that status.");
    }
    if ((status === "rented" && listing.deal_type !== "rent") || (status === "sold" && listing.deal_type !== "buy")) {
      throw new HttpError(409, "deal_status_mismatch", "Choose a closed status that matches this listing's deal type.");
    }
    database.prepare(`
      UPDATE listings SET status = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND creator_id = ?
    `).run(status, id, user.id);
    logAudit(user.id, "listing.owner_status_changed", "listing", id, { from: listing.status, to: status });
    return json({ id, status });
  } catch (error) {
    return errorResponse(error);
  }
}
