import { NextRequest } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { database, randomUUID } from "@/lib/server/database";
import { errorResponse, HttpError, json, logAudit, requireSameOrigin } from "@/lib/server/http";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type VerificationRequestContext = { params: Promise<{ id: string }> };

const checkTypes = ["identity", "authority", "title_documents", "project_approval", "legal_opinion", "physical_inspection"] as const;
const requestSchema = z.object({
  checkType: z.enum(checkTypes),
  scope: z.string().trim().min(10).max(500),
});

export async function POST(request: NextRequest, context: VerificationRequestContext) {
  try {
    requireSameOrigin(request);
    const user = await requireUser(["owner"]);
    const { id } = await context.params;
    let value: unknown;
    try {
      value = await request.json();
    } catch {
      throw new HttpError(400, "invalid_json", "Request body must be valid JSON.");
    }
    const body = requestSchema.parse(value);
    const listing = database
      .prepare("SELECT id, creator_id FROM listings WHERE id = ? LIMIT 1")
      .get(id) as { id: string; creator_id: string | null } | undefined;
    if (!listing || listing.creator_id !== user.id) {
      throw new HttpError(404, "listing_not_found", "This property listing was not found.");
    }
    const idempotent = database.prepare(`
      SELECT id FROM verification_cases
      WHERE listing_id = ? AND check_type = ?
        AND status IN ('requested', 'in_review', 'pending_second_review')
      LIMIT 1
    `).get(id, body.checkType) as { id: string } | undefined;
    if (idempotent) return json({ id: idempotent.id, status: "requested" });

    const caseId = randomUUID();
    database.prepare(`
      INSERT INTO verification_cases(id, listing_id, check_type, scope)
      VALUES (?, ?, ?, ?)
    `).run(caseId, id, body.checkType, body.scope);
    logAudit(user.id, "verification.requested", "verification_case", caseId, {
      listingId: id,
      checkType: body.checkType,
    });
    return json({ id: caseId, status: "requested" }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
