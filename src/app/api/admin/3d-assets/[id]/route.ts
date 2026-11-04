import { NextRequest } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { database } from "@/lib/server/database";
import { errorResponse, HttpError, json, logAudit, readJson, requireSameOrigin } from "@/lib/server/http";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type AssetContext = { params: Promise<{ id: string }> };
const reviewSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  note: z.string().trim().min(5).max(1000),
});

export async function PATCH(request: NextRequest, context: AssetContext) {
  try {
    requireSameOrigin(request);
    const user = await requireUser(["admin", "moderator"]);
    const { id } = await context.params;
    const body = await readJson(request, reviewSchema);
    const result = database.prepare(`
      UPDATE property_3d_assets
      SET review_status = ?, reviewer_id = ?, reviewed_at = CURRENT_TIMESTAMP, review_note = ?
      WHERE id = ? AND review_status = 'pending'
        AND listing_id IN (SELECT id FROM listings WHERE is_demo = 0)
    `).run(body.decision === "approve" ? "approved" : "rejected", user.id, body.note, id);
    if (Number(result.changes) !== 1) {
      throw new HttpError(409, "media_not_reviewable", "This media item is no longer awaiting review.");
    }
    logAudit(user.id, `property_media.review.${body.decision}`, "property_3d_asset", id, {
      note: body.note,
    });
    return json({ id, reviewStatus: body.decision === "approve" ? "approved" : "rejected" });
  } catch (error) {
    return errorResponse(error);
  }
}
