import { NextRequest } from "next/server";
import { decryptPrivateValue, requireUser } from "@/lib/server/auth";
import { database } from "@/lib/server/database";
import { errorResponse, HttpError, json, logAudit, requireSameOrigin } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type ContactContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: ContactContext) {
  try {
    requireSameOrigin(request);
    const user = await requireUser(["admin", "support"]);
    const { id } = await context.params;
    const requestRow = database
      .prepare("SELECT phone_encrypted FROM service_requests WHERE id = ? LIMIT 1")
      .get(id) as { phone_encrypted: string } | undefined;
    if (!requestRow) throw new HttpError(404, "service_request_not_found", "This service request was not found.");
    logAudit(user.id, "service_request.contact_accessed", "service_request", id);
    return json({ id, phone: decryptPrivateValue(requestRow.phone_encrypted) });
  } catch (error) {
    return errorResponse(error);
  }
}
