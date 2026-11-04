import { requireUser } from "@/lib/server/auth";
import { database } from "@/lib/server/database";
import { errorResponse, json } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireUser(["admin", "support"]);
    const requests = database.prepare(`
      SELECT deletion_requests.id, deletion_requests.user_id, deletion_requests.status,
        deletion_requests.created_at, users.email, users.display_name, users.role
      FROM deletion_requests JOIN users ON users.id = deletion_requests.user_id
      WHERE deletion_requests.status IN ('requested', 'in_progress')
      ORDER BY deletion_requests.created_at ASC LIMIT 100
    `).all();
    return json({ requests });
  } catch (error) {
    return errorResponse(error);
  }
}
