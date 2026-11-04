import { NextRequest } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { database } from "@/lib/server/database";
import { errorResponse, HttpError, json, logAudit, readJson, requireSameOrigin } from "@/lib/server/http";
import { reviewSchema } from "@/lib/server/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type ReviewContext = { params: Promise<{ id: string }> };

const nextStatus = {
  approve: "live",
  reject: "rejected",
  needs_changes: "needs_changes",
  restore: "submitted",
} as const;

export async function POST(request: NextRequest, context: ReviewContext) {
  try {
    requireSameOrigin(request);
    const user = await requireUser(["admin", "moderator"]);
    const { id } = await context.params;
    const body = await readJson(request, reviewSchema);
    database.exec("BEGIN IMMEDIATE");
    try {
      if (body.decision === "approve") {
        const photo = database.prepare(`
          SELECT COUNT(*) AS count FROM property_3d_assets
          WHERE listing_id = ? AND asset_type = 'property_photo'
            AND review_status IN ('pending', 'approved')
        `).get(id) as { count: number };
        if (photo.count === 0) {
          throw new HttpError(409, "property_photo_required", "This listing needs at least one reviewable property photo before it can be published.");
        }
        database.prepare(`
          UPDATE property_3d_assets
          SET review_status = 'approved', reviewer_id = ?, reviewed_at = CURRENT_TIMESTAMP,
            review_note = ?
          WHERE listing_id = ? AND review_status = 'pending'
        `).run(user.id, body.note, id);
      }
      const allowedStatuses = body.decision === "restore"
        ? ["rejected", "needs_changes"]
        : ["submitted"];
      const result = database.prepare(`
        UPDATE listings SET status = ?, review_note = ?, reviewed_by = ?,
          reviewed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status IN (${allowedStatuses.map(() => "?").join(", ")}) AND is_demo = 0
      `).run(nextStatus[body.decision], body.note, user.id, id, ...allowedStatuses);
      if (Number(result.changes) !== 1) {
        throw new HttpError(409, "listing_not_reviewable", "This real listing is no longer eligible for that moderation action.");
      }
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
    logAudit(user.id, `listing.review.${body.decision}`, "listing", id, {
      note: body.note,
      approvedMediaTogether: body.decision === "approve",
    });
    return json({ id, status: nextStatus[body.decision] });
  } catch (error) {
    return errorResponse(error);
  }
}
