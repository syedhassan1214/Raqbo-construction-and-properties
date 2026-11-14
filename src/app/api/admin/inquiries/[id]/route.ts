import { NextRequest } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { database } from "@/lib/server/database";
import {
  errorResponse,
  HttpError,
  json,
  logAudit,
  readJson,
  requireSameOrigin,
} from "@/lib/server/http";
import { inquiryStatusSchema } from "@/lib/server/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type InquiryContext = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: InquiryContext) {
  try {
    requireSameOrigin(request);
    const user = await requireUser(["admin", "support"]);
    const { id } = await context.params;
    const body = await readJson(request, inquiryStatusSchema);
    if (body.assignedTo) {
      const assignee = database.prepare(`
        SELECT id FROM users
        WHERE id = ? AND role IN ('admin', 'support') AND status = 'active'
      `).get(body.assignedTo);
      if (!assignee) {
        throw new HttpError(400, "invalid_assignee", "Choose an active admin or support user.");
      }
    }

    const result = database.prepare(`
      UPDATE inquiries
      SET status = COALESCE(?, status),
        buyer_update = CASE WHEN ? = 1 THEN ? ELSE buyer_update END,
        owner_update = CASE WHEN ? = 1 THEN ? ELSE owner_update END,
        assigned_to = CASE WHEN ? = 1 THEN ? ELSE assigned_to END
      WHERE id = ?
    `).run(
      body.status ?? null,
      body.buyerUpdate !== undefined ? 1 : 0,
      body.buyerUpdate ?? null,
      body.ownerUpdate !== undefined ? 1 : 0,
      body.ownerUpdate ?? null,
      body.assignedTo !== undefined ? 1 : 0,
      body.assignedTo ?? null,
      id,
    );
    if (Number(result.changes) !== 1) {
      throw new HttpError(404, "inquiry_not_found", "This coordination request was not found.");
    }
    logAudit(user.id, "inquiry.coordination_updated", "inquiry", id, {
      status: body.status ?? null,
      buyerUpdateChanged: body.buyerUpdate !== undefined,
      ownerUpdateChanged: body.ownerUpdate !== undefined,
      assignedTo: body.assignedTo,
    });
    return json({ id, status: body.status ?? null });
  } catch (error) {
    return errorResponse(error);
  }
}
