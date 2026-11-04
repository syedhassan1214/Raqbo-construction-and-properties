import { NextRequest } from "next/server";
import { requireUser, SESSION_COOKIE } from "@/lib/server/auth";
import { database, randomUUID } from "@/lib/server/database";
import { errorResponse, json, logAudit, requireSameOrigin } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    requireSameOrigin(request);
    const user = await requireUser();
    const existing = database
      .prepare("SELECT id FROM deletion_requests WHERE user_id = ? AND status IN ('requested', 'in_progress') LIMIT 1")
      .get(user.id) as { id: string } | undefined;
    const id = existing?.id ?? randomUUID();

    database.exec("BEGIN IMMEDIATE");
    try {
      if (!existing) {
        database.prepare("INSERT INTO deletion_requests(id, user_id) VALUES (?, ?)").run(id, user.id);
      }
      database
        .prepare("UPDATE users SET status = 'deletion_requested', updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .run(user.id);
      database.prepare("UPDATE sessions SET revoked_at = CURRENT_TIMESTAMP WHERE user_id = ? AND revoked_at IS NULL")
        .run(user.id);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
    logAudit(user.id, "account.deletion_requested", "user", user.id);
    const response = json({ requestId: id, status: "requested" });
    response.headers.append("Set-Cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${process.env.NODE_ENV === "production" ? "; Secure" : ""}`);
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
