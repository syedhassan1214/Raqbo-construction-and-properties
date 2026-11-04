import { NextRequest } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { database } from "@/lib/server/database";
import { errorResponse, HttpError, json, logAudit, readJson, requireSameOrigin } from "@/lib/server/http";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type ListingContext = { params: Promise<{ id: string }> };

const adminStatusSchema = z.object({
  status: z.enum(["live", "paused", "archived"]),
  note: z.string().trim().min(3).max(1000),
});

export async function PATCH(request: NextRequest, context: ListingContext) {
  try {
    requireSameOrigin(request);
    const user = await requireUser(["admin", "moderator"]);
    const { id } = await context.params;
    const body = await readJson(request, adminStatusSchema);
    const listing = database.prepare(
      "SELECT status FROM listings WHERE id = ? AND is_demo = 0",
    ).get(id) as { status: string } | undefined;
    if (!listing) throw new HttpError(404, "listing_not_found", "This listing was not found.");
    const allowed = listing.status === "live"
      ? ["paused", "archived"]
      : listing.status === "paused"
        ? ["live", "archived"]
        : [];
    if (!allowed.includes(body.status)) {
      throw new HttpError(409, "invalid_listing_transition", "This listing cannot be changed to that status.");
    }
    database.prepare(`
      UPDATE listings SET status = ?, review_note = ?, reviewed_by = ?,
        reviewed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND is_demo = 0
    `).run(body.status, body.note, user.id, id);
    logAudit(user.id, "listing.admin_status_changed", "listing", id, {
      from: listing.status,
      to: body.status,
      note: body.note,
    });
    return json({ id, status: body.status });
  } catch (error) {
    return errorResponse(error);
  }
}
