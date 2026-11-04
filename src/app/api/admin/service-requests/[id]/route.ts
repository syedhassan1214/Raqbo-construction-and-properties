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
import { serviceStatusSchema } from "@/lib/server/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type ServiceContext = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: ServiceContext) {
  try {
    requireSameOrigin(request);
    const user = await requireUser(["admin", "support"]);
    const { id } = await context.params;
    const body = await readJson(request, serviceStatusSchema);
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
      UPDATE service_requests
      SET status = COALESCE(?, status),
        assigned_to = CASE WHEN ? = 1 THEN ? ELSE assigned_to END,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(body.status ?? null, body.assignedTo !== undefined ? 1 : 0, body.assignedTo ?? null, id);
    if (Number(result.changes) !== 1) {
      throw new HttpError(404, "service_request_not_found", "This service request was not found.");
    }
    logAudit(user.id, body.status ? "service_request.status_updated" : "service_request.assigned", "service_request", id, {
      status: body.status ?? null,
      assignedTo: body.assignedTo,
      note: body.note,
    });
    return json({ id, status: body.status ?? null });
  } catch (error) {
    return errorResponse(error);
  }
}
