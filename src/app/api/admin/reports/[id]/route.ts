import { NextRequest } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { database } from "@/lib/server/database";
import { errorResponse, HttpError, json, logAudit, readJson, requireSameOrigin } from "@/lib/server/http";
import { reportStatusSchema } from "@/lib/server/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type ReportContext = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: ReportContext) {
  try {
    requireSameOrigin(request);
    const user = await requireUser(["admin", "moderator", "support"]);
    const { id } = await context.params;
    const body = await readJson(request, reportStatusSchema);
    const result = database.prepare("UPDATE reports SET status = ? WHERE id = ?").run(body.status, id);
    if (Number(result.changes) !== 1) throw new HttpError(404, "report_not_found", "This report was not found.");
    logAudit(user.id, "report.status_updated", "report", id, {
      status: body.status,
      note: body.note,
    });
    return json({ id, status: body.status });
  } catch (error) {
    return errorResponse(error);
  }
}
