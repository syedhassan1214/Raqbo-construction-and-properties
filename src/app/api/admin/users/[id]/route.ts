import { NextRequest } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { database } from "@/lib/server/database";
import { errorResponse, HttpError, json, logAudit, readJson, requireSameOrigin } from "@/lib/server/http";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type UserContext = { params: Promise<{ id: string }> };

const userStatusSchema = z.object({
  status: z.enum(["active", "suspended"]),
  reason: z.string().trim().min(5).max(1000),
});

export async function PATCH(request: NextRequest, context: UserContext) {
  try {
    requireSameOrigin(request);
    const admin = await requireUser(["admin"]);
    const { id } = await context.params;
    if (id === admin.id) throw new HttpError(409, "self_status_change", "You cannot suspend your own admin account.");
    const body = await readJson(request, userStatusSchema);
    const target = database
      .prepare("SELECT id, role FROM users WHERE id = ? AND status != 'deleted' LIMIT 1")
      .get(id) as { id: string; role: string } | undefined;
    if (!target) throw new HttpError(404, "user_not_found", "This account was not found.");
    if (target.role === "admin") {
      throw new HttpError(409, "admin_status_protected", "Admin accounts must be changed through the owner-controlled process.");
    }
    database.prepare("UPDATE users SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(body.status, id);
    if (body.status === "suspended") {
      database.prepare("UPDATE sessions SET revoked_at = CURRENT_TIMESTAMP WHERE user_id = ? AND revoked_at IS NULL")
        .run(id);
    }
    logAudit(admin.id, "user.status_updated", "user", id, {
      status: body.status,
      reason: body.reason,
    });
    return json({ id, status: body.status });
  } catch (error) {
    return errorResponse(error);
  }
}
