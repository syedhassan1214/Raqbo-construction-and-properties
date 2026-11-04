import { NextRequest } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { database } from "@/lib/server/database";
import { errorResponse, HttpError, json, logAudit, requireSameOrigin } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type ListingContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: ListingContext) {
  try {
    requireSameOrigin(request);
    const user = await requireUser(["owner"]);
    const { id } = await context.params;
    const propertyPhoto = database.prepare(`
      SELECT COUNT(*) AS count FROM property_3d_assets
      WHERE listing_id = ? AND owner_id = ? AND asset_type = 'property_photo'
        AND review_status IN ('pending', 'approved')
    `).get(id, user.id) as { count: number };
    if (propertyPhoto.count === 0) {
      throw new HttpError(409, "property_photo_required", "Upload at least one property photo before submitting your listing. Photos and videos will be reviewed with the listing.");
    }
    const result = database.prepare(`
      UPDATE listings SET status = 'submitted', updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND creator_id = ? AND status IN ('draft', 'needs_changes') AND is_demo = 0
    `).run(id, user.id);
    if (Number(result.changes) !== 1) {
      throw new HttpError(409, "listing_not_submittable", "Only your draft or returned listing can be submitted.");
    }
    logAudit(user.id, "listing.submitted", "listing", id);
    return json({ id, status: "submitted" });
  } catch (error) {
    return errorResponse(error);
  }
}
